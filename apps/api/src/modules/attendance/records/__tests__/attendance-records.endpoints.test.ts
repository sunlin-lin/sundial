/**
 * 打卡的端點測試（§7.1）。形狀比照 `attendance/settings/__tests__/attendance-settings.
 * endpoints.test.ts`。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射，以及 §4.2 座標可見範圍在 JSON 序列化後的鍵存不存在。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的資料。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：稽核測試的全部價值就在於驗真的有寫進去。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  attendanceRecords,
  attendanceResults,
  AttendanceResultStatusCode,
  attendanceSettings,
  AttendanceSourceTypeCode,
  AttendanceTypeCode,
  auditLogs,
  companies,
  companyUsers,
  departments,
  employeeDepartmentHistories,
  employeeEmployments,
  employees,
  EmploymentStatus,
  EmploymentTypeCode,
  permissions,
  rolePermissions,
  roles,
  companyUserRoles,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { attendanceRecordsRoutes } from '../attendance-records.routes.ts'
import { AttendanceRecordErrorCode } from '../attendance-records.errors.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-29 12:00:00。 */
const clock = fixedClock(new Date('2026-08-29T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string; readonly msg: string; readonly data?: Record<string, unknown> }
type EnvelopeShape<TData> = {
  readonly code: string
  readonly msg: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
  readonly cmd: string
  readonly locale: string
  readonly rspTS: string
  readonly expiresIn: number | null
}

const identityByToken = new Map<string, VerifiedIdentity>()
const permissionCodesByToken = new Map<string, ReadonlySet<string>>()

/** 身分驗證的替身（§7.3）：token 驗證與權限查詢屬於尚未落地的 `sessions`／`company-users` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: (_companyId, companyUserId) => {
    for (const [token, identity] of identityByToken) {
      if (identity.companyUserId === companyUserId) {
        return Promise.resolve(new Set(permissionCodesByToken.get(token) ?? []))
      }
    }
    return Promise.resolve(new Set())
  },
}

/** 與 `app/app.ts` 相同的中介層堆疊，理由見 `attendance-settings.endpoints.test.ts` 同名函式。 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(attendanceRecordsRoutes({ db, clock })),
    )

let database: Database
let app: ReturnType<typeof buildTestApp>

const asEnvelope = <TData>(payload: unknown): payload is EnvelopeShape<TData> => {
  if (typeof payload !== 'object' || payload === null) return false
  const record: Record<string, unknown> = { ...payload }
  return typeof record['code'] === 'string' && typeof record['msg'] === 'string' && Array.isArray(record['errors'])
}

const call = async <TData>(path: string, token: string, body: Record<string, unknown>) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rqTS: clock.transportNow(),
        cmd: path.replace(/^\//, '').replaceAll('/', '.'),
        locale: 'zh-TW',
        ...body,
      }),
    }),
  )
  const payload: unknown = await response.json()
  if (!asEnvelope<TData>(payload)) {
    throw new Error(`${path} 的回應不是 envelope 形狀（HTTP ${response.status}）：${JSON.stringify(payload)}`)
  }
  return { status: response.status, payload }
}

/** 直接讀 HTTP 回應的原始 JSON（不收斂成 envelope 型別），供斷言「鍵存不存在」使用。 */
const callRaw = async (path: string, token: string, body: Record<string, unknown>) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rqTS: clock.transportNow(),
        cmd: path.replace(/^\//, '').replaceAll('/', '.'),
        locale: 'zh-TW',
        ...body,
      }),
    }),
  )
  const payload = (await response.json()) as { readonly data: Record<string, unknown> | null }
  return { status: response.status, payload }
}

/** 一位員工＋一段有效任職＋一個登入帳號（帳號連結到這位員工）。 */
type EmployeeFixture = {
  readonly employeeId: string
  readonly employmentId: string
  readonly companyUserId: string
  readonly token: string
}

/** 建立一家公司；`registerEmployee` 可以在同一家公司內重複呼叫，建立多位員工（供他人撤銷／
 * 列表跨員工測試使用）。§7.3 的例外：這幾張表目前沒有從零開始的正式流程可以呼叫，直接寫入。 */
const registerCompany = async (): Promise<{
  companyId: string
  registerEmployee: (options?: { readonly permissionCodes?: readonly string[] }) => Promise<EmployeeFixture>
}> => {
  const companyId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `打卡測試公司-${companyId.slice(0, 8)}`,
    shortName: null,
    registeredPostalCode: null,
    registeredCity: null,
    registeredDistrict: null,
    registeredAddress: null,
    actualPostalCode: null,
    actualCity: null,
    actualDistrict: null,
    actualAddress: null,
    invoicePostalCode: null,
    invoiceCity: null,
    invoiceDistrict: null,
    invoiceAddress: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })

  const registerEmployee = async (
    options: { readonly permissionCodes?: readonly string[] } = {},
  ): Promise<EmployeeFixture> => {
    const userId = crypto.randomUUID()
    const companyUserId = crypto.randomUUID()
    const employeeId = crypto.randomUUID()
    const employmentId = crypto.randomUUID()
    const token = crypto.randomUUID()

    await database.insert(users).values({
      id: userId,
      username: `attendance-endpoint-${userId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(employees).values({
      id: employeeId,
      companyId,
      employeeCode: `E${employeeId.slice(0, 8)}`,
      name: `打卡測試員工-${employeeId.slice(0, 4)}`,
      gender: 'MALE',
      identityNumberEncrypted: randomBytes(32),
      identityNumberHash: randomBytes(32),
      birthdayEncrypted: randomBytes(16),
      phoneEncrypted: randomBytes(16),
      emailEncrypted: null,
      addressEncrypted: randomBytes(32),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    })
    await database.insert(companyUsers).values({
      id: companyUserId,
      companyId,
      userId,
      employeeId,
      status: 'ACTIVE',
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(employeeEmployments).values({
      id: employmentId,
      companyId,
      employeeId,
      employmentTypeCode: EmploymentTypeCode.FullTime,
      employmentNatureCode: null,
      hireDate: '2024-01-01',
      leaveDate: null,
      lastWorkingDate: null,
      leaveReasonCode: null,
      status: EmploymentStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    })

    const grantedCodes = options.permissionCodes ?? [
      'attendance.records.create',
      'attendance.records.revoke',
      'attendance.records.get',
    ]

    identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
    // 這一份只餵給身分驗證 middleware 的替身（`accessControl.loadPermissionCodes`），把關的是
    // 端點自己的粗粒度權限碼（§5.2）。
    permissionCodesByToken.set(token, new Set(grantedCodes))

    // **同時建立真的角色與指派**——`get.service.ts` 判斷座標可見範圍時，呼叫的是
    // `company-users` 模組真正的 `listPermissionCodes`（查 `company_user_roles`／`role_permissions`
    // ／`permissions`），不是上面那份 middleware 替身。少了這一段，`attendance.records.view-all`
    // 這類「不對應任何端點」的細粒度旗標永遠查不到，因為它從來不會出現在身分驗證的粗粒度判斷裡。
    if (grantedCodes.length > 0) {
      const roleId = crypto.randomUUID()
      await database.insert(roles).values({
        id: roleId,
        companyId,
        code: `TEST-ROLE-${roleId.slice(0, 8)}`,
        name: '打卡測試角色',
        description: null,
        isSystem: false,
        status: 'ACTIVE',
        deletedAt: null,
        deletedSeq: 0,
        createdAt: now,
        updatedAt: now,
      })
      const permissionRows = await database
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions)
        .where(eq(permissions.status, 'ACTIVE'))
      const permissionIdByCode = new Map(permissionRows.map((row) => [row.code, row.id]))
      for (const code of grantedCodes) {
        const permissionId = permissionIdByCode.get(code)
        if (permissionId === undefined) {
          throw new Error(`測試固定資料準備失敗：權限碼 ${code} 在 permissions 表裡查不到（migration 沒有 seed 到？）`)
        }
        await database.insert(rolePermissions).values({ companyId, roleId, permissionId, createdAt: now })
      }
      await database.insert(companyUserRoles).values({
        id: crypto.randomUUID(),
        companyId,
        companyUserId,
        roleId,
        assignedAt: now,
        assignedBy: companyUserId,
        revokedAt: null,
        revokedBy: null,
        revokedSeq: 0,
        createdAt: now,
        updatedAt: now,
      })
    }

    return { employeeId, employmentId, companyUserId, token }
  }

  return { companyId, registerEmployee }
}

const readAttendanceResult = async (companyId: string, employeeId: string, workDate: string) => {
  const rows = await database
    .select({
      workedMinutes: attendanceResults.workedMinutes,
      scheduledMinutes: attendanceResults.scheduledMinutes,
      resultStatusCode: attendanceResults.resultStatusCode,
    })
    .from(attendanceResults)
    .where(
      and(
        eq(attendanceResults.companyId, companyId),
        eq(attendanceResults.employeeId, employeeId),
        eq(attendanceResults.workDate, workDate),
      ),
    )
  return rows[0] ?? null
}

const readAuditLogs = (companyId: string, subjectId: string) =>
  database
    .select({
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
    })
    .from(auditLogs)
    .where(eq(auditLogs.companyId, companyId))
    .then((rows) => rows.filter((row) => row.subjectTable === 'attendance_records' && row.subjectId === subjectId))

const parseChanges = (raw: unknown): readonly { field: string; before?: unknown; after?: unknown; changed?: true }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly {
    field: string
    before?: unknown
    after?: unknown
    changed?: true
  }[]

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('attendance/records endpoints (integration)', () => {
  test('create：上班卡成功、下班卡依配對成功，回應含座標（本人一律可見）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const clockIn = await call<{ id: string; workDate: string; attendanceTypeCode: number; latitude: number | null }>(
      '/attendance/records/create',
      employee.token,
      { attendanceTypeCode: 1, latitude: 25.033, longitude: 121.5654, accuracyMeters: 10 },
    )
    expect(clockIn.status).toBe(200)
    expect(clockIn.payload.data.attendanceTypeCode).toBe(1)
    expect(clockIn.payload.data.workDate).toBe('2026-08-29')
    expect(clockIn.payload.data.latitude).toBeCloseTo(25.033, 5)

    const clockOut = await call<{ workDate: string; attendanceTypeCode: number }>(
      '/attendance/records/create',
      employee.token,
      { attendanceTypeCode: 2, latitude: null, longitude: null, accuracyMeters: null },
    )
    expect(clockOut.status).toBe(200)
    // 配對規則：下班卡的 work_date 取自它配對到的上班卡，這裡兩者同一天。
    expect(clockOut.payload.data.workDate).toBe(clockIn.payload.data.workDate)
  })

  test('create：打上班卡後，attendance_results 已有一筆 NO_SCHEDULE、worked_minutes=0 的紀錄（不是完全沒有紀錄）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const clockIn = await call<{ workDate: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const workDate = clockIn.payload.data.workDate

    // 只打了上班卡：判斷依據見 create.service.ts 檔頭「打卡成功後……」那一段——上班卡也要重算，
    // 這裡應該已經有一筆 NO_SCHEDULE、worked_minutes=0 的紀錄，而不是查無資料。UI 09「全體出勤」
    // 需要看到「今天已上班、尚未下班」這件事，不能讓這個人今天整天在畫面上消失。
    const afterClockIn = await readAttendanceResult(companyId, employee.employeeId, workDate)
    expect(afterClockIn).not.toBeNull()
    expect(afterClockIn?.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
    expect(afterClockIn?.workedMinutes).toBe(0)
  })

  test('create：打卡上班→打卡下班後，attendance_results 的 worked_minutes 正確反映兩次打卡的時間差', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const workDate = '2026-08-29'

    // 直接寫入一張三小時前的有效上班卡（測試用固定 clock 無法在同一支測試內前進時間，比照本檔
    // 「由核准補打卡建立的紀錄」測試的手法，直接造一筆過去的打卡事件），再透過真正的 create 端點
    // 打下班卡——這一步才是本測試要驗證的重算路徑。
    await database.insert(attendanceRecords).values({
      id: crypto.randomUUID(),
      companyId,
      employeeId: employee.employeeId,
      employmentId: employee.employmentId,
      employeeScheduleId: null,
      workDate,
      attendanceTypeCode: AttendanceTypeCode.ClockIn,
      sourceTypeCode: AttendanceSourceTypeCode.Field,
      sourceId: null,
      clockedAt: '2026-08-29 09:00:00',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      address: null,
      addressResolvedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      revokedSeq: 0,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })

    // 打下班卡：fixedClock 釘在台北時間 2026-08-29 12:00:00，與上面的上班卡相差 180 分鐘。
    const clockOut = await call<{ workDate: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 2,
    })
    expect(clockOut.status).toBe(200)
    expect(clockOut.payload.data.workDate).toBe(workDate)

    const afterClockOut = await readAttendanceResult(companyId, employee.employeeId, workDate)
    expect(afterClockOut).not.toBeNull()
    expect(afterClockOut?.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
    expect(afterClockOut?.workedMinutes).toBe(180)
  })

  test('create：already-punched，同一天已有一張有效上班卡時再打一次回 409', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    await call('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    const second = await call('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })

    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.AlreadyPunched)
  })

  test('create：no-clock-in-to-pair，沒有上班卡直接打下班卡（設定未建立時預設要求先上班卡）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const result = await call('/attendance/records/create', employee.token, { attendanceTypeCode: 2 })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.NoClockInToPair)
  })

  test('create：gps-required，公司出勤設定要求 GPS 但沒有帶座標', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const now = clock.now()
    await database.insert(attendanceSettings).values({
      id: crypto.randomUUID(),
      companyId,
      requireClockInBeforeClockOut: true,
      allowEmployeeCancellation: true,
      allowCorrectionRequest: true,
      correctionRequiresApproval: true,
      gpsEnabled: true,
      gpsRequired: true,
      createdAt: now,
      updatedAt: now,
    })

    const result = await call('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.GpsRequired)
  })

  test('revoke：本人撤銷自己的打卡成功，軟刪除且不寫稽核', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const revoked = await call<{ id: string; revokedAt: string | null; revokedBy: string | null }>(
      '/attendance/records/revoke',
      employee.token,
      { recordId: created.payload.data.id, reason: '打錯卡了' },
    )
    expect(revoked.status).toBe(200)
    expect(revoked.payload.data.revokedAt).not.toBeNull()
    expect(revoked.payload.data.revokedBy).toBe(employee.companyUserId)

    const logs = await readAuditLogs(companyId, created.payload.data.id)
    expect(logs.length).toBe(0)
  })

  test('revoke：撤銷成功後同一筆交易內重算 attendance_results（計畫 §4.3.1）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const clockIn = await call<{ id: string; workDate: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const clockOut = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 2,
    })
    const workDate = clockIn.payload.data.workDate

    // 撤銷下班卡：只剩一張有效上班卡，worked_minutes 算不出一組完整時間，應為 0。
    await call('/attendance/records/revoke', employee.token, {
      recordId: clockOut.payload.data.id,
      reason: '先撤銷下班卡',
    })
    const afterRevokeClockOut = await readAttendanceResult(companyId, employee.employeeId, workDate)
    expect(afterRevokeClockOut).not.toBeNull()
    expect(afterRevokeClockOut?.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
    expect(afterRevokeClockOut?.workedMinutes).toBe(0)
    expect(afterRevokeClockOut?.scheduledMinutes).toBe(0)

    // 再撤銷上班卡：當天完全沒有有效打卡，重算後仍是一筆 NO_SCHEDULE、worked_minutes=0 的紀錄
    // ——不是刪掉這筆判定結果（判定結果本身不因來源卡被撤銷而消失，只是重算成「這天沒有紀錄」）。
    await call('/attendance/records/revoke', employee.token, {
      recordId: clockIn.payload.data.id,
      reason: '再撤銷上班卡',
    })
    const afterRevokeBoth = await readAttendanceResult(companyId, employee.employeeId, workDate)
    expect(afterRevokeBoth).not.toBeNull()
    expect(afterRevokeBoth?.workedMinutes).toBe(0)
  })

  test('revoke：撤銷別人的記錄視同找不到（不接受 employeeId，範圍由 token 推出）', async () => {
    const { registerEmployee } = await registerCompany()
    const employeeA = await registerEmployee()
    const employeeB = await registerEmployee()

    const created = await call<{ id: string }>('/attendance/records/create', employeeA.token, {
      attendanceTypeCode: 1,
    })
    const result = await call('/attendance/records/revoke', employeeB.token, {
      recordId: created.payload.data.id,
      reason: '不是我的卡',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.RecordNotFound)
  })

  test('revoke-other：他人撤銷成功並寫入 audit_logs（座標三欄為 presence 級）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const reviewer = await registerEmployee({ permissionCodes: ['attendance.records.revoke-other'] })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
      latitude: 25.03,
      longitude: 121.56,
    })
    const revoked = await call<{ revokedBy: string | null }>('/attendance/records/revoke-other', reviewer.token, {
      recordId: created.payload.data.id,
      reason: '主管代為撤銷',
    })
    expect(revoked.status).toBe(200)
    expect(revoked.payload.data.revokedBy).toBe(reviewer.companyUserId)

    const logs = await readAuditLogs(companyId, created.payload.data.id)
    expect(logs.length).toBe(1)
    const [log] = logs
    if (log === undefined) throw new Error('稽核紀錄不存在')
    expect(log.action).toBe('attendance.records.revoke-other')
    expect(log.actorCompanyUserId).toBe(reviewer.companyUserId)

    const changes = parseChanges(log.changes)
    // 座標為 presence 級：只記「變更了」，不記經緯度原始值。
    const latitudeChange = changes.find((change) => change.field === 'latitude')
    expect(latitudeChange).toEqual({ field: 'latitude', changed: true })
    expect(JSON.stringify(latitudeChange)).not.toContain('25.03')
    // revokeReason 為 value 級：記值。
    expect(changes.find((change) => change.field === 'revokeReason')).toEqual({
      field: 'revokeReason',
      before: null,
      after: '主管代為撤銷',
    })
  })

  test('revoke-other：撤銷成功後同一筆交易內重算 attendance_results（計畫 §4.3.1，與 revoke 同一條規則）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const reviewer = await registerEmployee({ permissionCodes: ['attendance.records.revoke-other'] })

    const created = await call<{ id: string; workDate: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    await call('/attendance/records/revoke-other', reviewer.token, {
      recordId: created.payload.data.id,
      reason: '主管代為撤銷',
    })

    const result = await readAttendanceResult(companyId, employee.employeeId, created.payload.data.workDate)
    expect(result).not.toBeNull()
    expect(result?.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
    expect(result?.workedMinutes).toBe(0)
  })

  test('revoke-other：沒有權限碼時回 403', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const bystander = await registerEmployee({ permissionCodes: [] })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const result = await callRaw('/attendance/records/revoke-other', bystander.token, {
      recordId: created.payload.data.id,
      reason: '沒有權限也想撤銷',
    })
    expect(result.status).toBe(403)
  })

  test('revoke：已有下班卡時，需先撤銷下班卡才能撤銷其前面的上班卡', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const clockIn = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    const clockOut = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 2 })

    const blocked = await call('/attendance/records/revoke', employee.token, {
      recordId: clockIn.payload.data.id,
      reason: '想撤銷上班卡',
    })
    expect(blocked.status).toBe(422)
    expect(blocked.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.ClockOutMustBeRevokedFirst)

    const revokeClockOut = await call('/attendance/records/revoke', employee.token, {
      recordId: clockOut.payload.data.id,
      reason: '先撤銷下班卡',
    })
    expect(revokeClockOut.status).toBe(200)

    const revokeClockIn = await call('/attendance/records/revoke', employee.token, {
      recordId: clockIn.payload.data.id,
      reason: '再撤銷上班卡',
    })
    expect(revokeClockIn.status).toBe(200)
  })

  test('revoke：公司關掉 allow_employee_cancellation 後，本人撤銷被擋（缺口一）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const now = clock.now()

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })

    // 公司關掉這個開關——只有前端隱藏按鈕不算數（前端規範 §4.2），後端這裡也要擋。
    await database.insert(attendanceSettings).values({
      id: crypto.randomUUID(),
      companyId,
      requireClockInBeforeClockOut: true,
      allowEmployeeCancellation: false,
      allowCorrectionRequest: true,
      correctionRequiresApproval: true,
      gpsEnabled: true,
      gpsRequired: false,
      createdAt: now,
      updatedAt: now,
    })

    const blocked = await call('/attendance/records/revoke', employee.token, {
      recordId: created.payload.data.id,
      reason: '開關關了也想撤銷',
    })
    expect(blocked.status).toBe(422)
    expect(blocked.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.CancellationNotAllowed)

    // 這筆記錄仍然是未撤銷狀態——業務失敗不能留下任何寫入痕跡。
    const stillNotRevoked = await call<{ revokedAt: string | null }>('/attendance/records/get', employee.token, {
      recordId: created.payload.data.id,
    })
    expect(stillNotRevoked.payload.data?.revokedAt).toBeNull()
  })

  test('revoke：公司從未設定過出勤設定時（get 回 null），預設仍允許本人撤銷', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    // 刻意不插入 attendance_settings，模擬「這間公司從未進過設定頁」。
    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const revoked = await call('/attendance/records/revoke', employee.token, {
      recordId: created.payload.data.id,
      reason: '沒有設定過也應該能撤銷',
    })
    expect(revoked.status).toBe(200)
  })

  test('revoke-other：公司關掉 allow_employee_cancellation 不影響他人撤銷（這個開關管的是員工自助撤銷，不是人事代為撤銷）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const reviewer = await registerEmployee({ permissionCodes: ['attendance.records.revoke-other'] })
    const now = clock.now()

    await database.insert(attendanceSettings).values({
      id: crypto.randomUUID(),
      companyId,
      requireClockInBeforeClockOut: true,
      allowEmployeeCancellation: false,
      allowCorrectionRequest: true,
      correctionRequiresApproval: true,
      gpsEnabled: true,
      gpsRequired: false,
      createdAt: now,
      updatedAt: now,
    })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
    })
    const revoked = await call('/attendance/records/revoke-other', reviewer.token, {
      recordId: created.payload.data.id,
      reason: '員工自助撤銷被關了，但人事還是能代為撤銷',
    })
    expect(revoked.status).toBe(200)
  })

  test('list-own-by-date：只回本人在指定日期的打卡，分頁且不含座標與他人欄位（缺口二）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.list-own-by-date'],
    })
    const otherEmployee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.list-own-by-date'],
    })

    await call('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
      latitude: 25.02,
      longitude: 121.52,
    })
    await call('/attendance/records/create', otherEmployee.token, { attendanceTypeCode: 1 })

    const list = await callRaw('/attendance/records/list-own-by-date', employee.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    expect(list.status).toBe(200)
    const listData = list.payload.data as {
      readonly data: readonly Record<string, unknown>[]
      readonly pagination: { totalCount: number }
      readonly search: { date: string }
    }
    // 只看得到自己這一筆，看不到 otherEmployee 的。
    expect(listData.pagination.totalCount).toBe(1)
    expect(listData.data.length).toBe(1)
    expect(listData.search.date).toBe('2026-08-29')

    const item = listData.data[0]
    // 列表恆不含座標——即使查的是自己的資料，端點形狀（列表）仍決定不回座標。
    expect('latitude' in (item ?? {})).toBe(false)
    expect('longitude' in (item ?? {})).toBe(false)
    // 也不含員工姓名／工號／部門——查的必然是自己，不需要回聲。
    expect('employeeId' in (item ?? {})).toBe(false)
    expect('employeeName' in (item ?? {})).toBe(false)
    expect('departmentName' in (item ?? {})).toBe(false)
    expect(item?.['attendanceTypeCode']).toBe(1)
  })

  test('list-own-by-date：權限碼獨立於 list-by-date，只有 list-by-date 沒有本碼時回 403', async () => {
    const { registerEmployee } = await registerCompany()
    // 只授予人事／主管用的 list-by-date，刻意不給 list-own-by-date。
    const employee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.list-by-date'],
    })

    await call('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    const result = await callRaw('/attendance/records/list-own-by-date', employee.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    expect(result.status).toBe(403)
  })

  test('list-own-by-date：含已撤銷紀錄（Dashboard 需要知道這筆已經被撤銷，才能正確重建今日狀態）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee({
      permissionCodes: [
        'attendance.records.create',
        'attendance.records.revoke',
        'attendance.records.list-own-by-date',
      ],
    })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    await call('/attendance/records/revoke', employee.token, { recordId: created.payload.data.id, reason: '打錯了' })

    const list = await callRaw('/attendance/records/list-own-by-date', employee.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    const listData = list.payload.data as { readonly data: readonly Record<string, unknown>[] }
    expect(listData.data.length).toBe(1)
    expect(listData.data[0]?.['revokedAt']).not.toBeNull()
  })

  test('revoke：已撤銷的記錄再撤銷一次回 409 already-revoked', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    await call('/attendance/records/revoke', employee.token, {
      recordId: created.payload.data.id,
      reason: '第一次撤銷',
    })
    const second = await call('/attendance/records/revoke', employee.token, {
      recordId: created.payload.data.id,
      reason: '第二次撤銷',
    })
    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(AttendanceRecordErrorCode.AlreadyRevoked)
  })

  test('get：★ 三種情境——本人／有權限查他人／無權限查他人，斷言鍵存不存在而不是值', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const viewer = await registerEmployee({
      permissionCodes: ['attendance.records.get', 'attendance.records.view-all'],
    })
    const bystander = await registerEmployee({ permissionCodes: ['attendance.records.get'] })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 1,
      latitude: 25.04,
      longitude: 121.55,
    })
    const recordId = created.payload.data.id

    // 情境 1：查自己的——含 latitude／longitude 鍵。
    const own = await callRaw('/attendance/records/get', employee.token, { recordId })
    expect(own.status).toBe(200)
    expect(own.payload.data).not.toBeNull()
    const ownData = own.payload.data as Record<string, unknown>
    expect('latitude' in ownData).toBe(true)
    expect('longitude' in ownData).toBe(true)
    expect(ownData['latitude']).toBeCloseTo(25.04, 5)

    // 情境 2：具備 view-all 權限查別人的——含 latitude／longitude 鍵。
    const withPermission = await callRaw('/attendance/records/get', viewer.token, { recordId })
    expect(withPermission.status).toBe(200)
    const withPermissionData = withPermission.payload.data as Record<string, unknown>
    expect('latitude' in withPermissionData).toBe(true)
    expect('longitude' in withPermissionData).toBe(true)

    // 情境 3：不具備權限查別人的——★ 兩把鍵完全不出現（不是出現且為 null）。
    const withoutPermission = await callRaw('/attendance/records/get', bystander.token, { recordId })
    expect(withoutPermission.status).toBe(200)
    const withoutPermissionData = withoutPermission.payload.data as Record<string, unknown>
    expect('latitude' in withoutPermissionData).toBe(false)
    expect('longitude' in withoutPermissionData).toBe(false)
    // 其餘欄位（時間、地址）仍然看得到。
    expect(withoutPermissionData['id']).toBe(recordId)
  })

  test('get：查無資料（含跨公司）回 data: null，不是錯誤', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee()

    const result = await call<null>('/attendance/records/get', employee.token, { recordId: crypto.randomUUID() })
    expect(result.status).toBe(200)
    expect(result.payload.data).toBeNull()
  })

  test('get：撤銷後 revokedByName 帶出撤銷人姓名（比照 company-users/roles 的 assignedByName 既有作法，UI 23「撤銷資訊」）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.get'],
    })
    const reviewer = await registerEmployee({
      permissionCodes: ['attendance.records.revoke-other', 'attendance.records.get'],
    })

    // 未撤銷時 revokedByName 隨 revokedBy 一起是 null（同一個 LEFT JOIN 的自然結果）。
    const created = await call<{ id: string; revokedByName: string | null }>(
      '/attendance/records/create',
      employee.token,
      { attendanceTypeCode: 1 },
    )
    expect(created.payload.data.revokedByName).toBeNull()

    const [reviewerAccount] = await database
      .select({ username: users.username })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(eq(companyUsers.id, reviewer.companyUserId))
    if (reviewerAccount === undefined) throw new Error('撤銷者的登入帳號查不到')

    await call('/attendance/records/revoke-other', reviewer.token, {
      recordId: created.payload.data.id,
      reason: '主管代為撤銷',
    })

    const detail = await call<{ revokedBy: string | null; revokedByName: string | null }>(
      '/attendance/records/get',
      employee.token,
      { recordId: created.payload.data.id },
    )
    expect(detail.payload.data.revokedBy).toBe(reviewer.companyUserId)
    expect(detail.payload.data.revokedByName).toBe(reviewerAccount.username)
  })

  test('list-by-date：一次 JOIN 帶出員工姓名／工號／部門，分頁且不含座標', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employeeWithDept = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.list-by-date'],
    })
    const employeeWithoutDept = await registerEmployee()
    const now = clock.now()

    const departmentId = crypto.randomUUID()
    await database.insert(departments).values({
      id: departmentId,
      companyId,
      parentId: null,
      code: 'DEPT-A',
      name: '測試部門',
      description: null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    })
    await database.insert(employeeDepartmentHistories).values({
      id: crypto.randomUUID(),
      companyId,
      employmentId: employeeWithDept.employmentId,
      departmentId,
      effectiveFrom: '2024-01-01',
      effectiveTo: null,
      createdAt: now,
      updatedAt: now,
    })

    await call('/attendance/records/create', employeeWithDept.token, {
      attendanceTypeCode: 1,
      latitude: 25.01,
      longitude: 121.51,
    })
    await call('/attendance/records/create', employeeWithoutDept.token, { attendanceTypeCode: 1 })

    const list = await callRaw('/attendance/records/list-by-date', employeeWithDept.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    expect(list.status).toBe(200)
    const listData = list.payload.data as {
      readonly data: readonly Record<string, unknown>[]
      readonly pagination: { totalCount: number }
    }
    expect(listData.pagination.totalCount).toBe(2)
    expect(listData.data.length).toBe(2)

    const withDeptItem = listData.data.find((item) => item['employeeId'] === employeeWithDept.employeeId)
    expect(withDeptItem?.['departmentName']).toBe('測試部門')
    expect(withDeptItem?.['employeeCode']).toBeTruthy()
    // 列表恆不含座標——不是「查了但為 null」，是整個沒有這兩把鍵。
    expect('latitude' in (withDeptItem ?? {})).toBe(false)
    expect('longitude' in (withDeptItem ?? {})).toBe(false)

    const withoutDeptItem = listData.data.find((item) => item['employeeId'] === employeeWithoutDept.employeeId)
    expect(withoutDeptItem?.['departmentName']).toBeNull()

    // 篩選：只查有部門的那一位。
    const filtered = await callRaw('/attendance/records/list-by-date', employeeWithDept.token, {
      date: '2026-08-29',
      departmentId,
      perPage: 20,
      currentPage: 1,
    })
    const filteredData = filtered.payload.data as { readonly data: readonly Record<string, unknown>[] }
    expect(filteredData.data.length).toBe(1)
  })

  test('list-by-date：含已撤銷紀錄（審核情境需要看到本來就已經被撤銷的打卡）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.revoke', 'attendance.records.list-by-date'],
    })

    const created = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    await call('/attendance/records/revoke', employee.token, { recordId: created.payload.data.id, reason: '打錯了' })

    const list = await callRaw('/attendance/records/list-by-date', employee.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    const listData = list.payload.data as { readonly data: readonly Record<string, unknown>[] }
    expect(listData.data.length).toBe(1)
    expect(listData.data[0]?.['revokedAt']).not.toBeNull()
  })

  test('list-by-date：狀態篩選——全部（預設）／只看有效／只看已撤銷（UI 23）', async () => {
    const { registerEmployee } = await registerCompany()
    const employee = await registerEmployee({
      permissionCodes: ['attendance.records.create', 'attendance.records.revoke', 'attendance.records.list-by-date'],
    })

    const clockIn = await call<{ id: string }>('/attendance/records/create', employee.token, { attendanceTypeCode: 1 })
    const clockOut = await call<{ id: string }>('/attendance/records/create', employee.token, {
      attendanceTypeCode: 2,
    })
    await call('/attendance/records/revoke', employee.token, { recordId: clockOut.payload.data.id, reason: '打錯了' })

    // 未帶 status（等同 'all'）：兩筆都在。
    const all = await callRaw('/attendance/records/list-by-date', employee.token, {
      date: '2026-08-29',
      perPage: 20,
      currentPage: 1,
    })
    const allData = all.payload.data as {
      readonly search: { readonly status: string }
      readonly data: readonly Record<string, unknown>[]
    }
    expect(allData.data.length).toBe(2)
    // search 回聲必須是解析後的值（§1.4），未帶時回聲 'all'，不是「這把鍵不存在」。
    expect(allData.search.status).toBe('all')

    const activeOnly = await callRaw('/attendance/records/list-by-date', employee.token, {
      date: '2026-08-29',
      status: 'active',
      perPage: 20,
      currentPage: 1,
    })
    const activeData = activeOnly.payload.data as { readonly data: readonly Record<string, unknown>[] }
    expect(activeData.data.length).toBe(1)
    expect(activeData.data[0]?.['id']).toBe(clockIn.payload.data.id)
    expect(activeData.data[0]?.['revokedAt']).toBeNull()

    const revokedOnly = await callRaw('/attendance/records/list-by-date', employee.token, {
      date: '2026-08-29',
      status: 'revoked',
      perPage: 20,
      currentPage: 1,
    })
    const revokedData = revokedOnly.payload.data as { readonly data: readonly Record<string, unknown>[] }
    expect(revokedData.data.length).toBe(1)
    expect(revokedData.data[0]?.['id']).toBe(clockOut.payload.data.id)
    expect(revokedData.data[0]?.['revokedAt']).not.toBeNull()
  })

  test('list-by-date：預設排序先依員工工號、同一員工再依打卡時間，且分頁跨頁不重複不遺漏（UI 23）', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employeeA = await registerEmployee({ permissionCodes: ['attendance.records.list-by-date'] })
    const employeeB = await registerEmployee()
    const employeeC = await registerEmployee()
    const now = clock.now()

    // 每位員工兩筆，clockedAt 刻意「後面的先插入」——如果排序其實是靠插入順序（或主鍵遞增）湊巧
    // 對的，這裡會先露餡。三位員工各自的 employeeCode 由 registerEmployee 隨機產生，測試不假設
    // 誰的代碼比較小：先用不分頁的一次查詢建立「正確順序」的基準，再用分頁查詢比對是否一致。
    const insertPunch = (
      employee: EmployeeFixture,
      clockedAt: string,
      attendanceTypeCode: (typeof AttendanceTypeCode)[keyof typeof AttendanceTypeCode],
    ) =>
      database.insert(attendanceRecords).values({
        id: crypto.randomUUID(),
        companyId,
        employeeId: employee.employeeId,
        employmentId: employee.employmentId,
        employeeScheduleId: null,
        workDate: '2026-08-29',
        attendanceTypeCode,
        sourceTypeCode: AttendanceSourceTypeCode.Field,
        sourceId: null,
        clockedAt,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        address: null,
        addressResolvedAt: null,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
        revokedSeq: 0,
        createdAt: now,
        updatedAt: now,
      })

    for (const employee of [employeeA, employeeB, employeeC]) {
      await insertPunch(employee, '2026-08-29 18:00:00', AttendanceTypeCode.ClockOut)
      await insertPunch(employee, '2026-08-29 08:00:00', AttendanceTypeCode.ClockIn)
    }

    const fullPage = await callRaw('/attendance/records/list-by-date', employeeA.token, {
      date: '2026-08-29',
      perPage: 10,
      currentPage: 1,
    })
    const fullData = (
      fullPage.payload.data as {
        readonly data: readonly { readonly id: string; readonly employeeCode: string; readonly clockedAt: string }[]
      }
    ).data
    expect(fullData.length).toBe(6)

    // 同一員工的兩筆必須是 08:00 在 18:00 之前（依打卡時間由早到晚），不管插入順序。
    const byEmployeeCode = new Map<string, string[]>()
    for (const row of fullData) {
      byEmployeeCode.set(row.employeeCode, [...(byEmployeeCode.get(row.employeeCode) ?? []), row.clockedAt])
    }
    for (const clockedAtList of byEmployeeCode.values()) {
      expect(clockedAtList).toEqual(['2026-08-29 08:00:00', '2026-08-29 18:00:00'])
    }

    // 員工工號必須是非遞減（同一員工的兩筆相鄰出現，不同員工之間依工號排序）。
    const employeeCodes = fullData.map((row) => row.employeeCode)
    const sortedEmployeeCodes = [...employeeCodes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(employeeCodes).toEqual(sortedEmployeeCodes)

    // 分頁正確性：perPage=2 分三頁，串起來必須逐筆、逐序等於不分頁的結果——這是排序鍵組合以 id
    // 收尾、對每一列都唯一才能保證的事（見 impl/attendance-records.list-by-date.repository.ts
    // 檔頭「排序」段）。
    const pagedIds: string[] = []
    for (let page = 1; page <= 3; page += 1) {
      const pageResult = await callRaw('/attendance/records/list-by-date', employeeA.token, {
        date: '2026-08-29',
        perPage: 2,
        currentPage: page,
      })
      const pageRows = (pageResult.payload.data as { readonly data: readonly { readonly id: string }[] }).data
      expect(pageRows.length).toBe(2)
      pagedIds.push(...pageRows.map((row) => row.id))
    }
    expect(new Set(pagedIds).size).toBe(6) // 沒有重複
    expect(pagedIds).toEqual(fullData.map((row) => row.id)) // 順序與不分頁的結果逐筆相同
  })

  test('revoke：由核准補打卡建立的紀錄（人工補登來源）一樣能正常撤銷，不因來源被擋', async () => {
    const { companyId, registerEmployee } = await registerCompany()
    const employee = await registerEmployee()
    const now = clock.now()
    const recordId = crypto.randomUUID()

    // Stage 8（補打卡申請）尚未實作，這裡直接寫入一筆來源為人工補登的打卡，模擬「核准後建立的
    // 正式打卡」，驗證 revoke 的檢查邏輯確實沒有依 source_type_code 分支（計畫 §4.3.1）。
    await database.insert(attendanceRecords).values({
      id: recordId,
      companyId,
      employeeId: employee.employeeId,
      employmentId: employee.employmentId,
      employeeScheduleId: null,
      workDate: '2026-08-29',
      attendanceTypeCode: AttendanceTypeCode.ClockIn,
      sourceTypeCode: AttendanceSourceTypeCode.ManualCorrection,
      sourceId: null,
      clockedAt: now,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      address: null,
      addressResolvedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      revokedSeq: 0,
      createdAt: now,
      updatedAt: now,
    })

    const result = await call('/attendance/records/revoke', employee.token, { recordId, reason: '人工補登也能撤銷' })
    expect(result.status).toBe(200)
  })
})
