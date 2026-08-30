/**
 * 補打卡申請的端點測試（§7.1）。形狀比照 `attendance/records/__tests__/attendance-records.
 * endpoints.test.ts`，但省略角色／權限指派的資料表寫入——本次目錄的三個動作全部只依賴身分驗證
 * middleware 的粗粒度權限碼（§5.2），不像 `attendance/records` 的 `get` 需要在執行期額外查詢
 * `company_user_roles`／`role_permissions` 判斷細粒度旗標，因此測試替身只需要
 * `accessControl.loadPermissionCodes` 這一層。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀與
 * HTTP status／envelope `code` 的映射。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的資料。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  attendanceRecords,
  AttendanceCorrectionRequestStatusCode,
  AttendanceSourceTypeCode,
  AttendanceTypeCode,
  companies,
  companyUsers,
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
import { attendanceCorrectionRequestsRoutes } from '../attendance-correction-requests.routes.ts'
import { AttendanceCorrectionRequestErrorCode } from '../attendance-correction-requests.errors.ts'

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

type RequestDetailShape = {
  readonly id: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: number
  readonly requestedClockedAt: string
  readonly reason: string
  readonly statusCode: number
  readonly createdAt: string
  readonly updatedAt: string
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

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(attendanceCorrectionRequestsRoutes({ db, clock })),
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

type EmployeeFixture = {
  readonly employeeId: string
  readonly employmentId: string
  readonly companyUserId: string
  readonly token: string
}

/** 建立一家公司；`registerEmployee` 可以在同一家公司內重複呼叫，建立多位員工。§7.3 的例外：
 * 這幾張表目前沒有從零開始的正式流程可以呼叫，直接寫入。 */
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
    name: `補打卡申請測試公司-${companyId.slice(0, 8)}`,
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
      username: `correction-request-endpoint-${userId}`,
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
      name: `補打卡申請測試員工-${employeeId.slice(0, 4)}`,
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
      'attendance.correction-requests.submit',
      'attendance.correction-requests.withdraw',
      'attendance.correction-requests.list-own',
    ]

    identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
    permissionCodesByToken.set(token, new Set(grantedCodes))

    return { employeeId, employmentId, companyUserId, token }
  }

  return { companyId, registerEmployee }
}

const validSubmitBody = {
  attendanceTypeCode: AttendanceTypeCode.ClockIn,
  workDate: '2026-08-20',
  requestedClockedAt: '2026-08-20 09:00:00',
  reason: '手機沒電，忘記打卡',
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('attendance/correction-requests endpoints (integration)', () => {
  test('提交成功：狀態為待審核，不寫入 attendance_records', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()

    const result = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(result.status).toBe(200)
    expect(result.payload.data.employeeId).toBe(employee.employeeId)
    expect(result.payload.data.employmentId).toBe(employee.employmentId)
    expect(result.payload.data.statusCode).toBe(AttendanceCorrectionRequestStatusCode.Pending)
    expect(result.payload.data.reason).toBe(validSubmitBody.reason)

    // ★ 計畫 §4.6：申請本身不寫入 attendance_records，那是核准後（Stage 9）才會發生的事。
    const recordRows = await database
      .select({ id: attendanceRecords.id })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.employeeId, employee.employeeId))
    expect(recordRows.length).toBe(0)
  })

  test('不可選擇未來日期', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()

    const result = await call<RequestDetailShape>('/attendance/correction-requests/submit', employee.token, {
      ...validSubmitBody,
      workDate: '2099-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(AttendanceCorrectionRequestErrorCode.FutureDateNotAllowed)
  })

  test('同一工作日、同一類型已有待審核申請時，不可重複送出（唯一鍵擋）', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()

    const first = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(first.status).toBe(200)

    const second = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(AttendanceCorrectionRequestErrorCode.DuplicatePendingRequest)
  })

  test('已有效打卡的類型不可重複申請', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()
    const now = clock.now()

    await database.insert(attendanceRecords).values({
      id: crypto.randomUUID(),
      companyId: company.companyId,
      employeeId: employee.employeeId,
      employmentId: employee.employmentId,
      employeeScheduleId: null,
      workDate: validSubmitBody.workDate,
      attendanceTypeCode: AttendanceTypeCode.ClockIn,
      sourceTypeCode: AttendanceSourceTypeCode.Field,
      sourceId: null,
      clockedAt: `${validSubmitBody.workDate} 09:00:00`,
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

    const result = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(result.status).toBe(409)
    expect(result.payload.errors[0]?.code).toBe(AttendanceCorrectionRequestErrorCode.AlreadyPunched)
  })

  test('撤回：待審核申請可以撤回，撤回後狀態變為已撤回，且可以重新提交同一天同一類型', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()

    const submitted = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(submitted.status).toBe(200)

    const withdrawn = await call<RequestDetailShape>('/attendance/correction-requests/withdraw', employee.token, {
      requestId: submitted.payload.data.id,
    })
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.payload.data.statusCode).toBe(AttendanceCorrectionRequestStatusCode.Withdrawn)

    // 撤回釋出待審核名額，同一天同一類型可以再送一次。
    const resubmitted = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(resubmitted.status).toBe(200)
    expect(resubmitted.payload.data.id).not.toBe(submitted.payload.data.id)
  })

  test('撤回：已撤回的申請不能再撤回一次', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()

    const submitted = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    await call('/attendance/correction-requests/withdraw', employee.token, { requestId: submitted.payload.data.id })

    const second = await call<RequestDetailShape>('/attendance/correction-requests/withdraw', employee.token, {
      requestId: submitted.payload.data.id,
    })
    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(AttendanceCorrectionRequestErrorCode.NotWithdrawable)
  })

  test('不能撤回別人的申請（回同一則 not-found，不洩漏存在與否）', async () => {
    const company = await registerCompany()
    const owner = await company.registerEmployee()
    const stranger = await company.registerEmployee()

    const submitted = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      owner.token,
      validSubmitBody,
    )

    const result = await call<RequestDetailShape>('/attendance/correction-requests/withdraw', stranger.token, {
      requestId: submitted.payload.data.id,
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(AttendanceCorrectionRequestErrorCode.NotFound)
  })

  test('查詢自己的申請：只看得到自己的，看不到別人的；狀態篩選生效', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee()
    const other = await company.registerEmployee()

    await call('/attendance/correction-requests/submit', employee.token, validSubmitBody)
    await call('/attendance/correction-requests/submit', other.token, validSubmitBody)

    const listed = await call<{ data: readonly RequestDetailShape[] }>(
      '/attendance/correction-requests/list-own',
      employee.token,
      { yearMonth: '2026-08', perPage: 20, currentPage: 1 },
    )
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data.length).toBe(1)
    expect(listed.payload.data.data[0]?.employeeId).toBeUndefined() // 列表不含 employeeId（見 routes 檔頭）

    const pendingOnly = await call<{ data: readonly RequestDetailShape[] }>(
      '/attendance/correction-requests/list-own',
      employee.token,
      { yearMonth: '2026-08', status: 'withdrawn', perPage: 20, currentPage: 1 },
    )
    expect(pendingOnly.payload.data.data.length).toBe(0)
  })

  test('沒有 attendance.correction-requests.submit 權限時呼叫 submit 回 403（§5.2）', async () => {
    const company = await registerCompany()
    const employee = await company.registerEmployee({
      permissionCodes: ['attendance.correction-requests.list-own'],
    })

    const result = await call<RequestDetailShape>(
      '/attendance/correction-requests/submit',
      employee.token,
      validSubmitBody,
    )
    expect(result.status).toBe(403)
  })
})
