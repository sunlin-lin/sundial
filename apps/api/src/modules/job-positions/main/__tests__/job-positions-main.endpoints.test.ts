/**
 * 職務主檔的端點測試（§7.1）。形狀與 `job-titles/main/__tests__/job-titles-main.endpoints.test.ts`
 * 完全同構——職務與職稱除了指向的表不同外，主檔規則逐字相同，本檔不重複每一種案例的註解說明。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, JobPositionStatus, jobPositions, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { JobPositionErrorCode } from '../job-positions-main.errors.ts'
import { jobPositionsMainRoutes } from '../job-positions-main.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string; readonly data?: Record<string, unknown> }
type EnvelopeShape<TData> = {
  readonly code: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
  readonly cmd: string
}

type JobPositionDetailShape = {
  readonly id: string
  readonly isSystem: boolean
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: 'ACTIVE' | 'INACTIVE'
}

type JobPositionListShape = {
  readonly data: readonly JobPositionDetailShape[]
  readonly pagination: { readonly totalCount: number }
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'job-positions.main.list',
        'job-positions.main.get',
        'job-positions.main.create',
        'job-positions.main.update',
        'job-positions.main.delete',
      ]),
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
        .use(jobPositionsMainRoutes({ db, clock })),
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

const registerCompany = async (): Promise<{ companyId: string; token: string }> => {
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
    name: `職務測試公司-${companyId.slice(0, 8)}`,
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
    username: `jp-test-${userId}`,
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
  return { companyId, token }
}

const createSystemDefaultJobPosition = async (): Promise<string> => {
  const id = crypto.randomUUID()
  const now = clock.now()
  await database.insert(jobPositions).values({
    id,
    companyId: null,
    code: `SYS-${id.slice(0, 8)}`,
    name: '系統預設職務',
    description: null,
    isSystem: true,
    status: JobPositionStatus.Active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  return id
}

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

const createJobPosition = (token: string, overrides: Record<string, unknown> = {}) =>
  call<JobPositionDetailShape>('/job-positions/main/create', token, {
    code: uniqueCode('POSITION'),
    name: '測試職務',
    ...overrides,
  })

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('job-positions/main endpoints (integration)', () => {
  test('新增職務成功，一律公司自訂（isSystem=false），可由 get 讀回', async () => {
    const company = await registerCompany()
    const code = uniqueCode('NEW')

    const created = await createJobPosition(company.token, { code, name: '技術主管' })
    expect(created.status).toBe(200)
    expect(created.payload.data.isSystem).toBe(false)
    expect(created.payload.data.status).toBe('ACTIVE')

    const fetched = await call<JobPositionDetailShape | null>('/job-positions/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data?.code).toBe(code)
  })

  test('同公司代碼重複回 409／300 與 code-duplicated', async () => {
    const company = await registerCompany()
    const code = uniqueCode('DUP')
    await createJobPosition(company.token, { code })

    const second = await createJobPosition(company.token, { code })
    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(JobPositionErrorCode.CodeDuplicated)
  })

  test('列表分頁：新增三筆，perPage=2 時第一頁兩筆、totalCount 至少 3', async () => {
    const company = await registerCompany()
    await createJobPosition(company.token)
    await createJobPosition(company.token)
    await createJobPosition(company.token)

    const listed = await call<JobPositionListShape>('/job-positions/main/list', company.token, {
      perPage: 2,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data).toHaveLength(2)
    expect(listed.payload.data.pagination.totalCount).toBeGreaterThanOrEqual(3)
  })

  test('修改職務：改名稱、代碼、說明與狀態', async () => {
    const company = await registerCompany()
    const created = await createJobPosition(company.token, { name: '舊名稱' })
    const renamed = uniqueCode('RENAMED')

    const updated = await call<JobPositionDetailShape>('/job-positions/main/update', company.token, {
      id: created.payload.data.id,
      code: renamed,
      name: '新名稱',
      description: '補上一段說明',
      status: 'INACTIVE',
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.data.name).toBe('新名稱')
    expect(updated.payload.data.status).toBe('INACTIVE')
  })

  test('★ 系統預設職務不能被公司修改或刪除，回 not-found（§3.2）', async () => {
    const company = await registerCompany()
    const systemJobPositionId = await createSystemDefaultJobPosition()

    const fetched = await call<JobPositionDetailShape | null>('/job-positions/main/get', company.token, {
      id: systemJobPositionId,
    })
    expect(fetched.payload.data?.isSystem).toBe(true)

    const updateResult = await call('/job-positions/main/update', company.token, {
      id: systemJobPositionId,
      code: uniqueCode('HACK'),
      name: '想改系統預設',
      status: 'ACTIVE',
    })
    expect(updateResult.status).toBe(422)
    expect(updateResult.payload.errors[0]?.code).toBe(JobPositionErrorCode.NotFound)

    const deleteResult = await call('/job-positions/main/delete', company.token, { id: systemJobPositionId })
    expect(deleteResult.status).toBe(422)
    expect(deleteResult.payload.errors[0]?.code).toBe(JobPositionErrorCode.NotFound)
  })

  test('軟刪除後同一個代碼可以再建立', async () => {
    const company = await registerCompany()
    const code = uniqueCode('REUSE')
    const created = await createJobPosition(company.token, { code })

    const deleted = await call<{ id: string }>('/job-positions/main/delete', company.token, {
      id: created.payload.data.id,
    })
    expect(deleted.status).toBe(200)

    const recreated = await createJobPosition(company.token, { code })
    expect(recreated.status).toBe(200)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('B 公司看不到 A 公司自訂的職務（§4.2）', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await createJobPosition(companyA.token)

    const crossCompanyGet = await call<JobPositionDetailShape | null>('/job-positions/main/get', companyB.token, {
      id: created.payload.data.id,
    })
    expect(crossCompanyGet.payload.data).toBeNull()
  })

  test('未帶 token 一律回 401／900', async () => {
    const response = await app.handle(
      new Request('http://localhost/job-positions/main/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'job-positions.main.list',
          locale: 'zh-TW',
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
