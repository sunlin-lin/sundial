/**
 * 職稱歷史的端點測試（§7.1）。與 `department-histories` 的同名測試不同：本模組**有** `create`
 * 端點（見 routes 檔頭），因此涵蓋 `create` 與 `list` 兩支。併發相關的重疊檢查另有專屬的
 * `employments-job-title-histories.concurrency.test.ts`，本檔只測一般路徑與業務錯誤。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createEmployment } from '../../main/employments-main.service.ts'
import type { EmploymentsMainContext } from '../../main/domain/employment-context.ts'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, employees, JobTitleStatus, jobTitles, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { JobTitleHistoryErrorCode } from '../employments-job-title-histories.errors.ts'
import { employmentsJobTitleHistoriesRoutes } from '../employments-job-title-histories.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string }
type EnvelopeShape<TData> = { readonly code: string; readonly errors: readonly ErrorItemShape[]; readonly data: TData }
type JobTitleHistoryShape = {
  readonly id: string
  readonly employmentId: string
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(new Set(['employments.job-title-histories.list', 'employments.job-title-histories.create'])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employmentsJobTitleHistoriesRoutes({ db, clock })),
    )

let database: Database
let app: ReturnType<typeof buildTestApp>

const asEnvelope = <TData>(payload: unknown): payload is EnvelopeShape<TData> => {
  if (typeof payload !== 'object' || payload === null) return false
  const record: Record<string, unknown> = { ...payload }
  return typeof record['code'] === 'string' && Array.isArray(record['errors'])
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

/** 建立一家公司、一位操作者、一位員工、一筆任職與一個職稱，回傳可用的 token 與其他 id。 */
const registerFixture = async (): Promise<{ token: string; employmentId: string; jobTitleId: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const jobTitleId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `職稱歷史測試公司-${companyId.slice(0, 8)}`,
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
    username: `jth-test-${userId}`,
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
    name: '職稱歷史測試員工',
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
  await database.insert(jobTitles).values({
    id: jobTitleId,
    companyId,
    code: `TITLE-${jobTitleId.slice(0, 8)}`,
    name: '測試職稱',
    description: null,
    isSystem: false,
    status: JobTitleStatus.Active,
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
  return { token, employmentId: employmentResult.value.id, jobTitleId }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employments/job-title-histories endpoints (integration)', () => {
  test('新增職稱歷史成功，可由 list 讀回', async () => {
    const { token, employmentId, jobTitleId } = await registerFixture()

    const created = await call<JobTitleHistoryShape>('/employments/job-title-histories/create', token, {
      employmentId,
      jobTitleId,
      effectiveFrom: '2024-01-01',
    })
    expect(created.status).toBe(200)
    expect(created.payload.data.employmentId).toBe(employmentId)
    expect(created.payload.data.jobTitleId).toBe(jobTitleId)
    expect(created.payload.data.effectiveTo).toBeNull()

    const listed = await call<{ data: JobTitleHistoryShape[] }>('/employments/job-title-histories/list', token, {
      employmentId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.payload.data.data).toHaveLength(1)
    expect(listed.payload.data.data[0]?.id).toBe(created.payload.data.id)
  })

  test('任職不存在回 422／300 與 employment-not-found', async () => {
    const { token, jobTitleId } = await registerFixture()

    const result = await call('/employments/job-title-histories/create', token, {
      employmentId: crypto.randomUUID(),
      jobTitleId,
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(JobTitleHistoryErrorCode.EmploymentNotFound)
  })

  test('職稱不存在回 422／300 與 job-title-not-found', async () => {
    const { token, employmentId } = await registerFixture()

    const result = await call('/employments/job-title-histories/create', token, {
      employmentId,
      jobTitleId: crypto.randomUUID(),
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(JobTitleHistoryErrorCode.JobTitleNotFound)
  })

  test('同一任職重疊期間回 422／300 與 period-overlap', async () => {
    const { token, employmentId, jobTitleId } = await registerFixture()

    await call('/employments/job-title-histories/create', token, {
      employmentId,
      jobTitleId,
      effectiveFrom: '2024-01-01',
    })

    const overlapping = await call('/employments/job-title-histories/create', token, {
      employmentId,
      jobTitleId,
      effectiveFrom: '2024-06-01',
    })
    expect(overlapping.status).toBe(422)
    expect(overlapping.payload.errors[0]?.code).toBe(JobTitleHistoryErrorCode.PeriodOverlap)
  })

  test('未帶 token 一律回 401／900', async () => {
    const response = await app.handle(
      new Request('http://localhost/employments/job-title-histories/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'employments.job-title-histories.list',
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
