/**
 * 任職主檔的端點測試（§7.1）。形狀比照 `departments/main/__tests__/departments-main.endpoints.test.ts`
 * ——從 HTTP 打進去，同時檢查 HTTP status 與 envelope `code`。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司與員工。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { employmentsMainRoutes } from '../employments-main.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

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

type EmploymentDetailShape = {
  readonly id: string
  readonly employeeId: string
  readonly employmentTypeCode: number
  readonly hireDate: string
  readonly leaveDate: string | null
  readonly status: 'ACTIVE' | 'LEFT'
}

const identityByToken = new Map<string, VerifiedIdentity>()

/** 身分驗證的替身（§7.3）：token 驗證與權限查詢屬於 `sessions`／`company-users` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set(['employments.main.list', 'employments.main.get', 'employments.main.create', 'employments.main.leave']),
    ),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employmentsMainRoutes({ db, clock })),
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

/** 建立一家公司、一位操作者與一位員工。§7.3 的例外：那幾個模組尚未落地，只能直接寫入。 */
const registerCompanyWithEmployee = async (): Promise<{ companyId: string; token: string; employeeId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
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
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: '測試員工',
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

  identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
  return { companyId, token, employeeId }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employments/main endpoints (integration)', () => {
  test('新增任職成功，可由 get／list 讀回', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()

    const created = await call<EmploymentDetailShape>('/employments/main/create', token, {
      employeeId,
      employmentTypeCode: 1,
      hireDate: '2024-01-01',
    })
    expect(created.status).toBe(200)
    expect(created.payload.data.status).toBe('ACTIVE')
    expect(created.payload.data.leaveDate).toBeNull()

    const fetched = await call<EmploymentDetailShape | null>('/employments/main/get', token, {
      id: created.payload.data.id,
    })
    expect(fetched.status).toBe(200)
    expect(fetched.payload.data?.id).toBe(created.payload.data.id)

    const listed = await call<{ data: EmploymentDetailShape[] }>('/employments/main/list', token, {
      employeeId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data.map((item) => item.id)).toContain(created.payload.data.id)
  })

  test('目標員工不存在時回 422 employee-not-found', async () => {
    const { token } = await registerCompanyWithEmployee()

    const result = await call('/employments/main/create', token, {
      employeeId: crypto.randomUUID(),
      employmentTypeCode: 1,
      hireDate: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors.map((error) => error.code)).toEqual(['employments.main.errors.employee-not-found'])
  })

  test('依序（非併發）建立兩筆重疊任職，第二筆回 422 period-overlap', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()

    const first = await call<EmploymentDetailShape>('/employments/main/create', token, {
      employeeId,
      employmentTypeCode: 1,
      hireDate: '2024-01-01',
    })
    expect(first.status).toBe(200)

    const second = await call('/employments/main/create', token, {
      employeeId,
      employmentTypeCode: 1,
      hireDate: '2024-06-01',
    })
    expect(second.status).toBe(422)
    expect(second.payload.errors.map((error) => error.code)).toEqual(['employments.main.errors.period-overlap'])
  })

  test('辦理離職成功；三缺一時 schema 直接拒絕；last_working_date 晚於 leave_date 時回 422', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()
    const created = await call<EmploymentDetailShape>('/employments/main/create', token, {
      employeeId,
      employmentTypeCode: 1,
      hireDate: '2024-01-01',
    })

    const invalidRange = await call('/employments/main/leave', token, {
      id: created.payload.data.id,
      leaveDate: '2024-12-01',
      lastWorkingDate: '2024-12-31',
      leaveReasonCode: 1,
    })
    expect(invalidRange.status).toBe(422)
    expect(invalidRange.payload.errors.map((error) => error.code)).toEqual([
      'employments.main.errors.last-working-date-after-leave-date',
    ])

    const left = await call<EmploymentDetailShape>('/employments/main/leave', token, {
      id: created.payload.data.id,
      leaveDate: '2024-12-31',
      lastWorkingDate: '2024-12-30',
      leaveReasonCode: 1,
    })
    expect(left.status).toBe(200)
    expect(left.payload.data.status).toBe('LEFT')

    const again = await call('/employments/main/leave', token, {
      id: created.payload.data.id,
      leaveDate: '2024-12-31',
      lastWorkingDate: '2024-12-30',
      leaveReasonCode: 1,
    })
    expect(again.status).toBe(422)
    expect(again.payload.errors.map((error) => error.code)).toEqual(['employments.main.errors.already-left'])
  })

  test('查無資料的 get 回 data: null，不是 404', async () => {
    const { token } = await registerCompanyWithEmployee()
    const result = await call<EmploymentDetailShape | null>('/employments/main/get', token, { id: crypto.randomUUID() })
    expect(result.status).toBe(200)
    expect(result.payload.data).toBeNull()
  })
})
