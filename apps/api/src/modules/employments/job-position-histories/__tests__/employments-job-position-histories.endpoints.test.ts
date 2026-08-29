/**
 * 職務歷史的端點測試（§7.1）。**`create` 一次收 `jobPositionIds` 陣列**（可多個），本檔特別涵蓋
 * 「一次指派兩個不同職務、一次成功」這條路徑——這正是本模組與其餘歷史表最大的行為差異
 * （字典：「同一任職可同時有多個有效職務」）。併發相關的鎖粒度測試另有專屬的
 * `employments-job-position-histories.concurrency.test.ts`，本檔只測一般路徑與業務錯誤。
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
  employees,
  JobPositionStatus,
  jobPositions,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { JobPositionHistoryErrorCode } from '../employments-job-position-histories.errors.ts'
import { employmentsJobPositionHistoriesRoutes } from '../employments-job-position-histories.routes.ts'

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
type JobPositionHistoryShape = {
  readonly id: string
  readonly employmentId: string
  readonly jobPositionId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(new Set(['employments.job-position-histories.list', 'employments.job-position-histories.create'])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employmentsJobPositionHistoriesRoutes({ db, clock })),
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

/** 建立一家公司、一位操作者、一位員工、一筆任職與兩個職務，回傳可用的 token 與其他 id。 */
const registerFixture = async (): Promise<{
  token: string
  employmentId: string
  jobPositionIdA: string
  jobPositionIdB: string
}> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const jobPositionIdA = crypto.randomUUID()
  const jobPositionIdB = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `職務歷史測試公司-${companyId.slice(0, 8)}`,
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
    username: `jph-test-${userId}`,
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
    name: '職務歷史測試員工',
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
  await database.insert(jobPositions).values([
    {
      id: jobPositionIdA,
      companyId,
      code: `POSITION-A-${jobPositionIdA.slice(0, 6)}`,
      name: '職務 A',
      description: null,
      isSystem: false,
      status: JobPositionStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
    {
      id: jobPositionIdB,
      companyId,
      code: `POSITION-B-${jobPositionIdB.slice(0, 6)}`,
      name: '職務 B',
      description: null,
      isSystem: false,
      status: JobPositionStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedSeq: 0,
    },
  ])

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
  return { token, employmentId: employmentResult.value.id, jobPositionIdA, jobPositionIdB }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employments/job-position-histories endpoints (integration)', () => {
  test('★ 一次指派兩個不同職務，一次成功，list 讀回兩筆', async () => {
    const { token, employmentId, jobPositionIdA, jobPositionIdB } = await registerFixture()

    const created = await call<{ items: JobPositionHistoryShape[] }>(
      '/employments/job-position-histories/create',
      token,
      {
        employmentId,
        jobPositionIds: [jobPositionIdA, jobPositionIdB],
        effectiveFrom: '2024-01-01',
      },
    )
    expect(created.status).toBe(200)
    expect(created.payload.data.items).toHaveLength(2)
    const returnedJobPositionIds = new Set(created.payload.data.items.map((item) => item.jobPositionId))
    expect(returnedJobPositionIds).toEqual(new Set([jobPositionIdA, jobPositionIdB]))

    const listed = await call<{ data: JobPositionHistoryShape[] }>('/employments/job-position-histories/list', token, {
      employmentId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.payload.data.data).toHaveLength(2)
  })

  test('任職不存在回 422／300 與 employment-not-found', async () => {
    const { token, jobPositionIdA } = await registerFixture()

    const result = await call('/employments/job-position-histories/create', token, {
      employmentId: crypto.randomUUID(),
      jobPositionIds: [jobPositionIdA],
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(JobPositionHistoryErrorCode.EmploymentNotFound)
  })

  test('職務不存在回 422／300 與 job-position-not-found（整批一個都不寫入）', async () => {
    const { token, employmentId, jobPositionIdA } = await registerFixture()

    const result = await call('/employments/job-position-histories/create', token, {
      employmentId,
      jobPositionIds: [jobPositionIdA, crypto.randomUUID()],
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(JobPositionHistoryErrorCode.JobPositionNotFound)

    // 整批失敗，連存在的那一個職務也不該被寫入。
    const listed = await call<{ data: JobPositionHistoryShape[] }>('/employments/job-position-histories/list', token, {
      employmentId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.payload.data.data).toHaveLength(0)
  })

  test('同一任職、同一職務重疊期間回 422／300 與 period-overlap', async () => {
    const { token, employmentId, jobPositionIdA } = await registerFixture()

    await call('/employments/job-position-histories/create', token, {
      employmentId,
      jobPositionIds: [jobPositionIdA],
      effectiveFrom: '2024-01-01',
    })

    const overlapping = await call('/employments/job-position-histories/create', token, {
      employmentId,
      jobPositionIds: [jobPositionIdA],
      effectiveFrom: '2024-06-01',
    })
    expect(overlapping.status).toBe(422)
    expect(overlapping.payload.errors[0]?.code).toBe(JobPositionHistoryErrorCode.PeriodOverlap)
  })

  test('未帶 token 一律回 401／900', async () => {
    const response = await app.handle(
      new Request('http://localhost/employments/job-position-histories/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'employments.job-position-histories.list',
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
