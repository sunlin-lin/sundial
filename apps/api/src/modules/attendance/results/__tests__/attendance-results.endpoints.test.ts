/**
 * 出勤判定結果的端點測試（§7.1）。形狀比照 `attendance/settings/__tests__/attendance-settings.
 * endpoints.test.ts`（同樣不需要真正的角色查詢，`recalculate-no-schedule` 只檢查粗粒度權限碼）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的包含 envelope 形狀與批次重算的實際寫回結果。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  attendanceRecords,
  attendanceResults,
  AttendanceResultStatusCode,
  AttendanceSourceTypeCode,
  AttendanceTypeCode,
  companies,
  companyUsers,
  departments,
  employeeDepartmentHistories,
  employeeEmployments,
  employees,
  EmploymentStatus,
  EmploymentTypeCode,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { attendanceResultsRoutes } from '../attendance-results.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-29 12:00:00。 */
const clock = fixedClock(new Date('2026-08-29T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string; readonly msg: string }
type EnvelopeShape<TData> = {
  readonly code: string
  readonly msg: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
}

const identityByToken = new Map<string, VerifiedIdentity>()
const permissionCodesByCompanyUserId = new Map<string, ReadonlySet<string>>()

/** 身分驗證的替身（§7.3）：這支端點只檢查粗粒度權限碼，不需要真正的角色查詢。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: (_companyId, companyUserId) =>
    Promise.resolve(new Set(permissionCodesByCompanyUserId.get(companyUserId) ?? [])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(attendanceResultsRoutes({ db, clock })),
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

/** 建立一家公司與一位員工（含一段有效任職），供直接寫入 `attendance_records`／`attendance_results`
 * 固定資料使用（§7.3 的例外：到職／打卡不是本測試要驗的東西，直接寫入比跑完整流程更清楚）。 */
const registerCompanyWithEmployee = async (): Promise<{
  readonly companyId: string
  readonly employeeId: string
  readonly employmentId: string
  readonly token: string
}> => {
  const companyId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const employmentId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `出勤判定測試公司-${companyId.slice(0, 8)}`,
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
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: `出勤判定測試員工-${employeeId.slice(0, 4)}`,
    gender: 'MALE',
    identityNumberEncrypted: null,
    identityNumberHash: null,
    birthdayEncrypted: null,
    phoneEncrypted: null,
    emailEncrypted: null,
    addressEncrypted: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
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

  const companyUserId = crypto.randomUUID()
  identityByToken.set(token, { sessionId: crypto.randomUUID(), userId: crypto.randomUUID(), companyId, companyUserId })
  permissionCodesByCompanyUserId.set(companyUserId, new Set(['attendance.results.recalculate-no-schedule']))

  return { companyId, employeeId, employmentId, token }
}

const insertValidPunch = async (options: {
  readonly companyId: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: (typeof AttendanceTypeCode)[keyof typeof AttendanceTypeCode]
  readonly clockedAt: string
}) => {
  const now = clock.now()
  await database.insert(attendanceRecords).values({
    id: crypto.randomUUID(),
    companyId: options.companyId,
    employeeId: options.employeeId,
    employmentId: options.employmentId,
    employeeScheduleId: null,
    workDate: options.workDate,
    attendanceTypeCode: options.attendanceTypeCode,
    sourceTypeCode: AttendanceSourceTypeCode.Field,
    sourceId: null,
    clockedAt: options.clockedAt,
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
}

/** 直接寫入一筆「陳舊」的 NO_SCHEDULE 判定結果，模擬重算前的狀態。 */
const insertStaleNoScheduleResult = async (options: {
  readonly companyId: string
  readonly employeeId: string
  readonly workDate: string
}) => {
  const now = clock.now()
  await database.insert(attendanceResults).values({
    id: crypto.randomUUID(),
    companyId: options.companyId,
    employeeId: options.employeeId,
    employeeScheduleId: null,
    workDate: options.workDate,
    scheduledMinutes: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    absenceMinutes: 0,
    leaveMinutes: 0,
    overtimeMinutes: 0,
    resultStatusCode: AttendanceResultStatusCode.NoSchedule,
    calculatedAt: now,
    updatedAt: now,
  })
}

/**
 * 一家公司底下可重複呼叫 `registerEmployee` 建立多位員工（供 `list`／`list-own` 的部門篩選、
 * 人員篩選、範圍隔離等跨員工測試使用）。與 `registerCompanyWithEmployee` 的差異：後者是
 * 「一家公司恰好一位員工」的簡化版，只供既有的 `recalculate-no-schedule` 測試使用；這裡改採
 * `attendance/records/__tests__/attendance-records.endpoints.test.ts` 的 `registerCompany`／
 * `registerEmployee` 形狀，因為 Stage 7 的測試需要同一家公司內比較「這位員工」與「那位員工」。
 */
const registerCompany = async (): Promise<{
  readonly companyId: string
  readonly registerEmployee: (options?: { readonly permissionCodes?: readonly string[] }) => Promise<{
    readonly employeeId: string
    readonly employmentId: string
    readonly companyUserId: string
    readonly token: string
  }>
}> => {
  const companyId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `全體出勤測試公司-${companyId.slice(0, 8)}`,
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

  const registerEmployee = async (options: { readonly permissionCodes?: readonly string[] } = {}) => {
    const userId = crypto.randomUUID()
    const companyUserId = crypto.randomUUID()
    const employeeId = crypto.randomUUID()
    const employmentId = crypto.randomUUID()
    const token = crypto.randomUUID()

    await database.insert(users).values({
      id: userId,
      username: `attendance-results-endpoint-${userId}`,
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
      name: `全體出勤測試員工-${employeeId.slice(0, 4)}`,
      gender: 'MALE',
      identityNumberEncrypted: null,
      identityNumberHash: null,
      birthdayEncrypted: null,
      phoneEncrypted: null,
      emailEncrypted: null,
      addressEncrypted: null,
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

    identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
    permissionCodesByCompanyUserId.set(companyUserId, new Set(options.permissionCodes ?? []))

    return { employeeId, employmentId, companyUserId, token }
  }

  return { companyId, registerEmployee }
}

/** 部門主檔（測試固定資料）。 */
const insertDepartment = async (companyId: string, name: string) => {
  const now = clock.now()
  const departmentId = crypto.randomUUID()
  await database.insert(departments).values({
    id: departmentId,
    companyId,
    parentId: null,
    code: `DEPT-${departmentId.slice(0, 8)}`,
    name,
    description: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  return departmentId
}

/** 一段部門任職期間（`effectiveTo` 為 `null` 代表尚未結束）。 */
const insertDepartmentHistory = async (options: {
  readonly companyId: string
  readonly employmentId: string
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}) => {
  const now = clock.now()
  await database.insert(employeeDepartmentHistories).values({
    id: crypto.randomUUID(),
    companyId: options.companyId,
    employmentId: options.employmentId,
    departmentId: options.departmentId,
    effectiveFrom: options.effectiveFrom,
    effectiveTo: options.effectiveTo,
    createdAt: now,
    updatedAt: now,
  })
}

/** 直接寫入一筆判定結果，欄位可自訂（供 Stage 7 的多狀態／部門歷史測試使用；不透過重算引擎，
 * 因為要測的是「列表怎麼組裝既有的判定結果」，不是判定引擎本身，判定引擎已有自己的單元測試）。 */
const insertAttendanceResult = async (options: {
  readonly companyId: string
  readonly employeeId: string
  readonly workDate: string
  readonly workedMinutes?: number
  readonly lateMinutes?: number
  readonly earlyLeaveMinutes?: number
  readonly absenceMinutes?: number
  readonly leaveMinutes?: number
  readonly resultStatusCode?: (typeof AttendanceResultStatusCode)[keyof typeof AttendanceResultStatusCode]
}) => {
  const now = clock.now()
  await database.insert(attendanceResults).values({
    id: crypto.randomUUID(),
    companyId: options.companyId,
    employeeId: options.employeeId,
    employeeScheduleId: null,
    workDate: options.workDate,
    scheduledMinutes: 0,
    workedMinutes: options.workedMinutes ?? 0,
    lateMinutes: options.lateMinutes ?? 0,
    earlyLeaveMinutes: options.earlyLeaveMinutes ?? 0,
    absenceMinutes: options.absenceMinutes ?? 0,
    leaveMinutes: options.leaveMinutes ?? 0,
    overtimeMinutes: 0,
    resultStatusCode: options.resultStatusCode ?? AttendanceResultStatusCode.NoSchedule,
    calculatedAt: now,
    updatedAt: now,
  })
}

const readAttendanceResult = async (companyId: string, employeeId: string, workDate: string) => {
  const rows = await database
    .select({ workedMinutes: attendanceResults.workedMinutes, resultStatusCode: attendanceResults.resultStatusCode })
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

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('attendance/results endpoints (integration)', () => {
  test('recalculate-no-schedule：沒有任何待重算紀錄時回 recalculatedCount: 0', async () => {
    const { token } = await registerCompanyWithEmployee()
    const result = await call<{ recalculatedCount: number }>('/attendance/results/recalculate-no-schedule', token, {})
    expect(result.status).toBe(200)
    expect(result.payload.data.recalculatedCount).toBe(0)
  })

  test('recalculate-no-schedule：陳舊的判定結果被重算成當時有效打卡算出的 worked_minutes', async () => {
    const { companyId, employeeId, employmentId, token } = await registerCompanyWithEmployee()
    const workDate = '2026-08-29'

    await insertValidPunch({
      companyId,
      employeeId,
      employmentId,
      workDate,
      attendanceTypeCode: AttendanceTypeCode.ClockIn,
      clockedAt: '2026-08-29 09:00:00',
    })
    await insertValidPunch({
      companyId,
      employeeId,
      employmentId,
      workDate,
      attendanceTypeCode: AttendanceTypeCode.ClockOut,
      clockedAt: '2026-08-29 18:00:00',
    })
    // 陳舊紀錄：worked_minutes 還停在 0（例如排班上線前一直沒有觸發重算的情境）。
    await insertStaleNoScheduleResult({ companyId, employeeId, workDate })

    const result = await call<{ recalculatedCount: number }>('/attendance/results/recalculate-no-schedule', token, {})
    expect(result.status).toBe(200)
    expect(result.payload.data.recalculatedCount).toBe(1)

    const updated = await readAttendanceResult(companyId, employeeId, workDate)
    expect(updated?.workedMinutes).toBe(9 * 60)
    expect(updated?.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
  })

  test('recalculate-no-schedule：只依呼叫者所屬公司範圍重算，不動別家公司的紀錄', async () => {
    const companyA = await registerCompanyWithEmployee()
    const companyB = await registerCompanyWithEmployee()
    const workDate = '2026-08-29'

    await insertStaleNoScheduleResult({ companyId: companyA.companyId, employeeId: companyA.employeeId, workDate })
    await insertStaleNoScheduleResult({ companyId: companyB.companyId, employeeId: companyB.employeeId, workDate })

    const result = await call<{ recalculatedCount: number }>(
      '/attendance/results/recalculate-no-schedule',
      companyA.token,
      {},
    )
    expect(result.status).toBe(200)
    // 只重算 A 公司那一筆——B 公司那一筆即使也是 NO_SCHEDULE，不在 A 的呼叫範圍內。
    expect(result.payload.data.recalculatedCount).toBe(1)
  })

  test('沒有權限碼時回 403', async () => {
    const token = crypto.randomUUID()
    const companyUserId = crypto.randomUUID()
    identityByToken.set(token, {
      sessionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      companyId: crypto.randomUUID(),
      companyUserId,
    })
    // 刻意不呼叫 `permissionCodesByCompanyUserId.set(...)`：查無權限碼時 `loadPermissionCodes`
    // 回空集合，等同「沒有這個權限碼」。
    const response = await app.handle(
      new Request('http://localhost/attendance/results/recalculate-no-schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'attendance.results.recalculate-no-schedule',
          locale: 'zh-TW',
        }),
      }),
    )
    expect(response.status).toBe(403)
  })

  describe('list（全體出勤，Stage 7）', () => {
    test('★ 部門顯示「該日有效的部門」：員工調過部門，查舊月份仍顯示舊部門，查新月份顯示新部門', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const viewer = await registerEmployee({ permissionCodes: ['attendance.results.list'] })
      const subject = await registerEmployee()

      const departmentA = await insertDepartment(companyId, '業務部')
      const departmentB = await insertDepartment(companyId, '財務部')
      // 2026-03-01 調部門：一月屬於業務部，三月起屬於財務部。「現在」（測試釘住的 clock）是
      // 2026-08-29，若程式碼誤用「員工目前部門」而不是「查詢日期當時的部門」，一月的查詢結果會
      // 被誤植成財務部（目前部門），這條測試就是為了擋下這個錯誤。
      await insertDepartmentHistory({
        companyId,
        employmentId: subject.employmentId,
        departmentId: departmentA,
        effectiveFrom: '2024-01-01',
        effectiveTo: '2026-02-28',
      })
      await insertDepartmentHistory({
        companyId,
        employmentId: subject.employmentId,
        departmentId: departmentB,
        effectiveFrom: '2026-03-01',
        effectiveTo: null,
      })

      await insertValidPunch({
        companyId,
        employeeId: subject.employeeId,
        employmentId: subject.employmentId,
        workDate: '2026-01-15',
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-01-15 09:00:00',
      })
      await insertValidPunch({
        companyId,
        employeeId: subject.employeeId,
        employmentId: subject.employmentId,
        workDate: '2026-01-15',
        attendanceTypeCode: AttendanceTypeCode.ClockOut,
        clockedAt: '2026-01-15 18:00:00',
      })
      await insertAttendanceResult({
        companyId,
        employeeId: subject.employeeId,
        workDate: '2026-01-15',
        workedMinutes: 540,
      })

      await insertValidPunch({
        companyId,
        employeeId: subject.employeeId,
        employmentId: subject.employmentId,
        workDate: '2026-03-16',
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-03-16 09:00:00',
      })
      await insertAttendanceResult({
        companyId,
        employeeId: subject.employeeId,
        workDate: '2026-03-16',
        workedMinutes: 0,
      })

      const january = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        {
          yearMonth: '2026-01',
          perPage: 20,
          currentPage: 1,
        },
      )
      expect(january.status).toBe(200)
      expect(january.payload.data.data).toHaveLength(1)
      expect(january.payload.data.data[0]?.['departmentName']).toBe('業務部')

      const march = await call<{ data: readonly Record<string, unknown>[] }>('/attendance/results/list', viewer.token, {
        yearMonth: '2026-03',
        perPage: 20,
        currentPage: 1,
      })
      expect(march.status).toBe(200)
      expect(march.payload.data.data).toHaveLength(1)
      expect(march.payload.data.data[0]?.['departmentName']).toBe('財務部')
    })

    test('查不到部門歸屬的員工，那一天的出勤仍要顯示，departmentName 為 null（不得整列消失，§2.3.1）', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const viewer = await registerEmployee({ permissionCodes: ['attendance.results.list'] })
      const subjectWithoutDepartment = await registerEmployee()
      const workDate = '2026-08-10'

      await insertValidPunch({
        companyId,
        employeeId: subjectWithoutDepartment.employeeId,
        employmentId: subjectWithoutDepartment.employmentId,
        workDate,
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-10 09:00:00',
      })
      await insertAttendanceResult({ companyId, employeeId: subjectWithoutDepartment.employeeId, workDate })

      const result = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        {
          yearMonth: '2026-08',
          perPage: 20,
          currentPage: 1,
        },
      )
      expect(result.status).toBe(200)
      const item = result.payload.data.data.find((row) => row['employeeId'] === subjectWithoutDepartment.employeeId)
      expect(item).toBeDefined()
      expect(item?.['departmentName']).toBeNull()
    })

    test('可依部門篩選，也可依人員（employeeId）篩選', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const viewer = await registerEmployee({ permissionCodes: ['attendance.results.list'] })
      const inDepartment = await registerEmployee()
      const outsideDepartment = await registerEmployee()
      const workDate = '2026-08-11'

      const departmentId = await insertDepartment(companyId, '測試部門')
      await insertDepartmentHistory({
        companyId,
        employmentId: inDepartment.employmentId,
        departmentId,
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
      })

      // 部門是由「這一天有效的打卡」取得 employment_id 才能解析出來（見 list.repository.ts 檔頭
      // 「★ 部門要顯示該日有效的部門」），因此篩選部門的這條測試需要真的有一張打卡卡可供解析。
      await insertValidPunch({
        companyId,
        employeeId: inDepartment.employeeId,
        employmentId: inDepartment.employmentId,
        workDate,
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-11 09:00:00',
      })
      await insertAttendanceResult({ companyId, employeeId: inDepartment.employeeId, workDate })
      await insertAttendanceResult({ companyId, employeeId: outsideDepartment.employeeId, workDate })

      const byDepartment = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        { yearMonth: '2026-08', departmentId, perPage: 20, currentPage: 1 },
      )
      expect(byDepartment.payload.data.data).toHaveLength(1)
      expect(byDepartment.payload.data.data[0]?.['employeeId']).toBe(inDepartment.employeeId)

      const byEmployee = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        {
          yearMonth: '2026-08',
          employeeId: outsideDepartment.employeeId,
          perPage: 20,
          currentPage: 1,
        },
      )
      expect(byEmployee.payload.data.data).toHaveLength(1)
      expect(byEmployee.payload.data.data[0]?.['employeeId']).toBe(outsideDepartment.employeeId)
    })

    test('狀態不是單一互斥值：同一天遲到與早退同時成立時，statuses 同時含兩者與 NO_SCHEDULE', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const viewer = await registerEmployee({ permissionCodes: ['attendance.results.list'] })
      const subject = await registerEmployee()
      const workDate = '2026-08-12'

      // 現階段 late_minutes／early_leave_minutes 只有無班表引擎恆寫 0，這裡直接寫入固定資料模擬
      // 「排班上線後兩者同時非零」的情境——不透過重算引擎，因為要測的是列表怎麼組裝既有判定結果，
      // 不是判定引擎本身（判定引擎有自己的單元測試）。
      await insertAttendanceResult({
        companyId,
        employeeId: subject.employeeId,
        workDate,
        workedMinutes: 400,
        lateMinutes: 10,
        earlyLeaveMinutes: 5,
      })

      const result = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        {
          yearMonth: '2026-08',
          perPage: 20,
          currentPage: 1,
        },
      )
      const item = result.payload.data.data.find((row) => row['employeeId'] === subject.employeeId)
      expect(item?.['statuses']).toEqual(expect.arrayContaining(['NO_SCHEDULE', 'LATE', 'EARLY_LEAVE']))
    })

    test('上下班時間與地點來自 attendance_records，不是 attendance_results；地址反查暫停時恆為 null', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const viewer = await registerEmployee({ permissionCodes: ['attendance.results.list'] })
      const subject = await registerEmployee()
      const workDate = '2026-08-13'

      await insertValidPunch({
        companyId,
        employeeId: subject.employeeId,
        employmentId: subject.employmentId,
        workDate,
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-13 08:55:00',
      })
      await insertValidPunch({
        companyId,
        employeeId: subject.employeeId,
        employmentId: subject.employmentId,
        workDate,
        attendanceTypeCode: AttendanceTypeCode.ClockOut,
        clockedAt: '2026-08-13 17:40:00',
      })
      await insertAttendanceResult({ companyId, employeeId: subject.employeeId, workDate, workedMinutes: 525 })

      const result = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list',
        viewer.token,
        {
          yearMonth: '2026-08',
          perPage: 20,
          currentPage: 1,
        },
      )
      const item = result.payload.data.data.find((row) => row['employeeId'] === subject.employeeId)
      expect(item?.['clockInAt']).toBe('2026-08-13 08:55:00')
      expect(item?.['clockOutAt']).toBe('2026-08-13 17:40:00')
      // 地址反查目前暫停（計畫 §4.8），這是預期行為，不是缺陷。
      expect(item?.['clockInAddress']).toBeNull()
      expect(item?.['clockOutAddress']).toBeNull()
      expect(item?.['workedMinutes']).toBe(525)
    })

    test('沒有權限碼時回 403', async () => {
      const { registerEmployee } = await registerCompany()
      const noPermission = await registerEmployee()
      const response = await app.handle(
        new Request('http://localhost/attendance/results/list', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${noPermission.token}` },
          body: JSON.stringify({
            rqTS: clock.transportNow(),
            cmd: 'attendance.results.list',
            locale: 'zh-TW',
            yearMonth: '2026-08',
            perPage: 20,
            currentPage: 1,
          }),
        }),
      )
      expect(response.status).toBe(403)
    })
  })

  describe('list-own（我的出勤，Stage 7）', () => {
    test('只回呼叫者本人的資料，看不到同公司其他員工的出勤', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const self = await registerEmployee({ permissionCodes: ['attendance.results.list-own'] })
      const other = await registerEmployee()
      const workDate = '2026-08-14'

      await insertAttendanceResult({ companyId, employeeId: self.employeeId, workDate, workedMinutes: 480 })
      await insertAttendanceResult({ companyId, employeeId: other.employeeId, workDate, workedMinutes: 480 })

      const result = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list-own',
        self.token,
        { yearMonth: '2026-08', perPage: 20, currentPage: 1 },
      )
      expect(result.status).toBe(200)
      expect(result.payload.data.data).toHaveLength(1)
      // list-own 不含員工／部門欄位（查的必然是自己），不應該出現 employeeId 這把鍵。
      expect('employeeId' in (result.payload.data.data[0] ?? {})).toBe(false)
    })

    test('呼叫者沒有連結員工（純協作者帳號）時回空清單，不是錯誤', async () => {
      const { companyId } = await registerCompany()
      const now = clock.now()
      const userId = crypto.randomUUID()
      const companyUserId = crypto.randomUUID()
      const token = crypto.randomUUID()

      await database.insert(users).values({
        id: userId,
        username: `ar-collaborator-${userId}`,
        passwordHash: 'not-a-real-hash',
        mustChangePassword: false,
        passwordChangedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      // employeeId 為 null：純協作者帳號，沒有連結任何員工。
      await database.insert(companyUsers).values({
        id: companyUserId,
        companyId,
        userId,
        employeeId: null,
        status: 'ACTIVE',
        activatedAt: now,
        deactivatedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
      permissionCodesByCompanyUserId.set(companyUserId, new Set(['attendance.results.list-own']))

      const result = await call<{ data: readonly Record<string, unknown>[] }>('/attendance/results/list-own', token, {
        yearMonth: '2026-08',
        perPage: 20,
        currentPage: 1,
      })
      expect(result.status).toBe(200)
      expect(result.payload.data.data).toHaveLength(0)
    })

    test('日期預設由新到舊排列（UI 12）', async () => {
      const { companyId, registerEmployee } = await registerCompany()
      const self = await registerEmployee({ permissionCodes: ['attendance.results.list-own'] })

      await insertAttendanceResult({ companyId, employeeId: self.employeeId, workDate: '2026-08-01' })
      await insertAttendanceResult({ companyId, employeeId: self.employeeId, workDate: '2026-08-20' })

      const result = await call<{ data: readonly Record<string, unknown>[] }>(
        '/attendance/results/list-own',
        self.token,
        { yearMonth: '2026-08', perPage: 20, currentPage: 1 },
      )
      expect(result.payload.data.data.map((row) => row['workDate'])).toEqual(['2026-08-20', '2026-08-01'])
    })

    test('沒有權限碼時回 403', async () => {
      const { registerEmployee } = await registerCompany()
      const noPermission = await registerEmployee()
      const response = await app.handle(
        new Request('http://localhost/attendance/results/list-own', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${noPermission.token}` },
          body: JSON.stringify({
            rqTS: clock.transportNow(),
            cmd: 'attendance.results.list-own',
            locale: 'zh-TW',
            yearMonth: '2026-08',
            perPage: 20,
            currentPage: 1,
          }),
        }),
      )
      expect(response.status).toBe(403)
    })
  })
})
