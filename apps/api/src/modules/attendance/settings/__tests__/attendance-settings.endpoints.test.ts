/**
 * 出勤設定的端點測試（§7.1）。形狀比照 `departments/main/__tests__/departments-main.endpoints.
 * test.ts`／`labor-pension/main/__tests__/labor-pension-main.endpoints.test.ts`。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的設定。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：稽核測試的全部價值就在於驗真的有寫進去。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { attendanceSettings, auditLogs, companies, companyUsers, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { attendanceSettingsRoutes } from '../attendance-settings.routes.ts'
import { AttendanceSettingsErrorCode } from '../attendance-settings.errors.ts'

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

type AttendanceSettingsDetailShape = {
  readonly id: string
  readonly requireClockInBeforeClockOut: boolean
  readonly allowEmployeeCancellation: boolean
  readonly allowCorrectionRequest: boolean
  readonly correctionRequiresApproval: boolean
  readonly gpsEnabled: boolean
  readonly gpsRequired: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

const identityByToken = new Map<string, VerifiedIdentity>()

/** 身分驗證的替身（§7.3）：token 驗證與權限查詢屬於尚未落地的 `sessions`／`company-users` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () => Promise.resolve(new Set(['attendance.settings.get', 'attendance.settings.update'])),
}

/** 與 `app/app.ts` 相同的中介層堆疊，理由見 `shifts-main.endpoints.test.ts` 同名函式。 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(attendanceSettingsRoutes({ db, clock })),
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

/** 建立一個公司與一位成員，回傳可用的 token。§7.3 的例外：那幾個模組尚未落地，只能直接寫入。 */
const registerCompany = async (): Promise<{ companyId: string; token: string; companyUserId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `測試公司-${companyId.slice(0, 8)}`,
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
  await database.insert(users).values({
    id: userId,
    username: `test-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
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
  return { companyId, token, companyUserId }
}

const defaultToggles = {
  requireClockInBeforeClockOut: true,
  allowEmployeeCancellation: true,
  allowCorrectionRequest: true,
  correctionRequiresApproval: true,
  gpsEnabled: true,
  gpsRequired: false,
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
    .then((rows) => rows.filter((row) => row.subjectTable === 'attendance_settings' && row.subjectId === subjectId))

const parseChanges = (raw: unknown): readonly { field: string; before?: unknown; after?: unknown }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly { field: string; before?: unknown; after?: unknown }[]

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('attendance/settings endpoints (integration)', () => {
  test('尚未設定過時查詢回 data: null，不是錯誤（§3.1.3；計畫已定案：不得冒用一組預設值）', async () => {
    const company = await registerCompany()
    const result = await call<AttendanceSettingsDetailShape | null>('/attendance/settings/get', company.token, {})
    expect(result.status).toBe(200)
    expect(result.payload.code).toBe('200')
    expect(result.payload.data).toBeNull()
  })

  test('第一次呼叫 update 即建立設定，get 讀回同一筆，並留一筆 before:null 的稽核', async () => {
    const company = await registerCompany()

    const updated = await call<AttendanceSettingsDetailShape>('/attendance/settings/update', company.token, {
      ...defaultToggles,
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.code).toBe('200')
    expect(updated.payload.data.gpsRequired).toBe(false)
    expect(updated.payload.data.createdAt).toBe(updated.payload.data.updatedAt)
    expect(updated.payload.cmd).toBe('attendance.settings.update')

    const fetched = await call<AttendanceSettingsDetailShape | null>('/attendance/settings/get', company.token, {})
    expect(fetched.payload.data?.id).toBe(updated.payload.data.id)
    expect(fetched.payload.data?.requireClockInBeforeClockOut).toBe(true)

    const logs = await readAuditLogs(company.companyId, updated.payload.data.id)
    expect(logs.length).toBe(1)
    const [log] = logs
    if (log === undefined) throw new Error('稽核紀錄不存在')
    expect(log.action).toBe('attendance.settings.update')
    expect(log.actorCompanyUserId).toBe(company.companyUserId)
    const changes = parseChanges(log.changes)
    expect(changes.find((change) => change.field === 'gpsRequired')).toEqual({
      field: 'gpsRequired',
      before: null,
      after: false,
    })
  })

  test('已有設定時再次 update 是修改，createdAt 不變、updatedAt 更新，稽核只記真正變動的欄位', async () => {
    const company = await registerCompany()

    const created = await call<AttendanceSettingsDetailShape>('/attendance/settings/update', company.token, {
      ...defaultToggles,
    })

    const changed = await call<AttendanceSettingsDetailShape>('/attendance/settings/update', company.token, {
      ...defaultToggles,
      gpsRequired: true,
    })
    expect(changed.status).toBe(200)
    expect(changed.payload.data.id).toBe(created.payload.data.id)
    expect(changed.payload.data.createdAt).toBe(created.payload.data.createdAt)
    expect(changed.payload.data.gpsRequired).toBe(true)

    const logs = await readAuditLogs(company.companyId, created.payload.data.id)
    expect(logs.length).toBe(2)
    // 不能假設陣列順序＝寫入順序：`clock` 是釘死的固定時間（§6.2），兩筆稽核的 `created_at`
    // 逐字相同，查詢又沒有 ORDER BY，因此改用內容分辨——建立那一筆的 changes 有全部六欄
    // （before 皆為 null），這裡要找的是只記到一欄變動的那一筆。
    const updateLog = logs.find((log) => parseChanges(log.changes).length === 1)
    if (updateLog === undefined) throw new Error('只記錄單一欄位變動的稽核紀錄不存在')
    const changes = parseChanges(updateLog.changes)
    expect(changes).toEqual([{ field: 'gpsRequired', before: false, after: true }])
  })

  test('沒有 attendance.settings.update 權限時呼叫 update 回 403（§5.2）', async () => {
    const company = await registerCompany()
    const readOnlyToken = crypto.randomUUID()
    identityByToken.set(readOnlyToken, {
      sessionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      companyId: company.companyId,
      companyUserId: company.companyUserId,
    })

    const restrictedAccessControl: AccessControlPorts = {
      verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
      renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
      loadPermissionCodes: () => Promise.resolve(new Set(['attendance.settings.get'])),
    }
    const restrictedApp = new Elysia()
      .use(requestContext)
      .use(errorHandler(clock))
      .use(responseEnvelope(clock))
      .use(
        new Elysia({ name: 'test-authenticated-group-restricted' })
          .use(identityGuard(restrictedAccessControl))
          .use(attendanceSettingsRoutes({ db: database, clock })),
      )

    const response = await restrictedApp.handle(
      new Request('http://localhost/attendance/settings/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${readOnlyToken}` },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'attendance.settings.update',
          locale: 'zh-TW',
          ...defaultToggles,
        }),
      }),
    )
    expect(response.status).toBe(403)
  })

  test('併發：兩個同時的第一次 update 只有一筆成功，另一筆回 409 與 concurrently-initialized', async () => {
    const company = await registerCompany()

    const [first, second] = await Promise.all([
      call<AttendanceSettingsDetailShape>('/attendance/settings/update', company.token, { ...defaultToggles }),
      call<AttendanceSettingsDetailShape>('/attendance/settings/update', company.token, { ...defaultToggles }),
    ])

    const statuses = [first.status, second.status].toSorted()
    // 兩者都可能成功（後到的落在前一個交易 commit 之後才開始查詢時，會直接走更新分支），
    // 因此只斷言「不會兩個都不成功」與「若有衝突，衝突訊息必須是這一則」，不強制哪一邊贏。
    expect(statuses.some((status) => status === 200)).toBe(true)
    for (const result of [first, second]) {
      if (result.status === 409) {
        expect(result.payload.errors[0]?.code).toBe(AttendanceSettingsErrorCode.ConcurrentlyInitialized)
      }
    }

    const settingsRows = await database
      .select({ id: attendanceSettings.id })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.companyId, company.companyId))
    expect(settingsRows.length).toBe(1)
  })
})
