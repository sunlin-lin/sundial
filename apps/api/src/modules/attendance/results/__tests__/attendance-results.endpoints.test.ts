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
  employeeEmployments,
  employees,
  EmploymentStatus,
  EmploymentTypeCode,
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
})
