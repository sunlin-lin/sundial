/**
 * 部門歷史的端點測試（§7.1）。`list` 與 `create` 兩支——`create` 是本輪新補的對外端點
 * （見 routes 檔的說明），測試形狀比照 `job-title-histories` 的同名測試檔。併發相關的重疊檢查
 * 另有專屬的 `employments-department-histories.concurrency.test.ts`，本檔只測一般路徑與業務錯誤。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createEmployment } from '../../main/employments-main.service.ts'
import type { EmploymentsMainContext } from '../../main/domain/employment-context.ts'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  companies,
  companyUsers,
  DepartmentStatus,
  departments,
  employees,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { DepartmentHistoryErrorCode } from '../employments-department-histories.errors.ts'
import { employmentsDepartmentHistoriesRoutes } from '../employments-department-histories.routes.ts'

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

type DepartmentHistoryShape = {
  readonly id: string
  readonly employmentId: string
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(new Set(['employments.department-histories.list', 'employments.department-histories.create'])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employmentsDepartmentHistoriesRoutes({ db, clock })),
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

/** 建立一家公司、一位操作者、一位員工、一筆任職與一個部門。 */
const registerFixture = async (): Promise<{ token: string; employmentId: string; departmentId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const departmentId = crypto.randomUUID()
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
  await database.insert(departments).values({
    id: departmentId,
    companyId,
    parentId: null,
    code: 'DEPT-A',
    name: '部門 A',
    description: null,
    status: DepartmentStatus.Active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })

  const employmentContext: EmploymentsMainContext = {
    db: database,
    clock,
    companyId,
    operatorCompanyUserId: companyUserId,
  }
  const employmentResult = await createEmployment(employmentContext, {
    employeeId,
    employmentTypeCode: 1,
    employmentNatureCode: null,
    hireDate: '2024-01-01',
  })
  if (!employmentResult.ok) throw new Error('測試固定資料準備失敗：建立任職沒有成功')

  identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
  return { token, employmentId: employmentResult.value.id, departmentId }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employments/department-histories endpoints (integration)', () => {
  test('新增部門歷史成功，可由 list 讀回', async () => {
    const { token, employmentId, departmentId } = await registerFixture()

    const created = await call<DepartmentHistoryShape>('/employments/department-histories/create', token, {
      employmentId,
      departmentId,
      effectiveFrom: '2024-01-01',
    })
    expect(created.status).toBe(200)
    expect(created.payload.data.employmentId).toBe(employmentId)
    expect(created.payload.data.departmentId).toBe(departmentId)
    expect(created.payload.data.effectiveTo).toBeNull()

    const listed = await call<{ data: DepartmentHistoryShape[] }>('/employments/department-histories/list', token, {
      employmentId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data).toHaveLength(1)
    expect(listed.payload.data.data[0]?.id).toBe(created.payload.data.id)
  })

  test('任職不存在回 422／300 與 employment-not-found', async () => {
    const { token, departmentId } = await registerFixture()

    const result = await call('/employments/department-histories/create', token, {
      employmentId: crypto.randomUUID(),
      departmentId,
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(DepartmentHistoryErrorCode.EmploymentNotFound)
  })

  test('部門不存在回 422／300 與 department-not-found', async () => {
    const { token, employmentId } = await registerFixture()

    const result = await call('/employments/department-histories/create', token, {
      employmentId,
      departmentId: crypto.randomUUID(),
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(DepartmentHistoryErrorCode.DepartmentNotFound)
  })

  test('同一任職重疊期間回 422／300 與 period-overlap', async () => {
    const { token, employmentId, departmentId } = await registerFixture()

    await call('/employments/department-histories/create', token, {
      employmentId,
      departmentId,
      effectiveFrom: '2024-01-01',
    })

    const overlapping = await call('/employments/department-histories/create', token, {
      employmentId,
      departmentId,
      effectiveFrom: '2024-06-01',
    })
    expect(overlapping.status).toBe(422)
    expect(overlapping.payload.errors[0]?.code).toBe(DepartmentHistoryErrorCode.PeriodOverlap)
  })

  test('未帶 token 一律回 401／900', async () => {
    const response = await app.handle(
      new Request('http://localhost/employments/department-histories/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'employments.department-histories.list',
          locale: 'zh-TW',
          employmentId: crypto.randomUUID(),
          perPage: 20,
          currentPage: 1,
        }),
      }),
    )
    const payload: unknown = await response.json()
    if (!asEnvelope(payload)) throw new Error('未登入的回應不是 envelope 形狀')
    expect(response.status).toBe(401)
  })
})
