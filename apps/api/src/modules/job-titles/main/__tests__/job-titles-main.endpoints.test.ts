/**
 * 職稱主檔的端點測試（§7.1）。形狀比照 `departments/main/__tests__/departments-main.endpoints.test.ts`，
 * 但職稱是扁平列表（無 tree／無成環規則），因此涵蓋範圍改成：CRUD、分頁列表、代碼重複、
 * 軟刪除後代碼可重用、跨公司隔離，以及**系統預設職稱不能被公司修改／刪除**這條本模組特有的規則。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, JobTitleStatus, jobTitles, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { JobTitleErrorCode } from '../job-titles-main.errors.ts'
import { jobTitlesMainRoutes } from '../job-titles-main.routes.ts'

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

type JobTitleDetailShape = {
  readonly id: string
  readonly isSystem: boolean
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: 'ACTIVE' | 'INACTIVE'
}

type JobTitleListShape = {
  readonly data: readonly JobTitleDetailShape[]
  readonly pagination: { readonly totalCount: number }
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'job-titles.main.list',
        'job-titles.main.get',
        'job-titles.main.create',
        'job-titles.main.update',
        'job-titles.main.delete',
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
        .use(jobTitlesMainRoutes({ db, clock })),
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
    name: `職稱測試公司-${companyId.slice(0, 8)}`,
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
    username: `jt-test-${userId}`,
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

/** 直接寫入一筆系統預設職稱（`company_id IS NULL`），供「不能被公司修改／刪除」的測試使用。 */
const createSystemDefaultJobTitle = async (): Promise<string> => {
  const id = crypto.randomUUID()
  const now = clock.now()
  await database.insert(jobTitles).values({
    id,
    companyId: null,
    code: `SYS-${id.slice(0, 8)}`,
    name: '系統預設職稱',
    description: null,
    isSystem: true,
    status: JobTitleStatus.Active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  return id
}

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

const createJobTitle = (token: string, overrides: Record<string, unknown> = {}) =>
  call<JobTitleDetailShape>('/job-titles/main/create', token, {
    code: uniqueCode('TITLE'),
    name: '測試職稱',
    ...overrides,
  })

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('job-titles/main endpoints (integration)', () => {
  test('新增職稱成功，一律公司自訂（isSystem=false），可由 get 讀回', async () => {
    const company = await registerCompany()
    const code = uniqueCode('NEW')

    const created = await createJobTitle(company.token, { code, name: '工程師' })
    expect(created.status).toBe(200)
    expect(created.payload.data.isSystem).toBe(false)
    expect(created.payload.data.status).toBe('ACTIVE')
    expect(created.payload.data.description).toBeNull()

    const fetched = await call<JobTitleDetailShape | null>('/job-titles/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data?.code).toBe(code)
  })

  test('同公司代碼重複回 409／300 與 code-duplicated', async () => {
    const company = await registerCompany()
    const code = uniqueCode('DUP')
    await createJobTitle(company.token, { code })

    const second = await createJobTitle(company.token, { code })
    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(JobTitleErrorCode.CodeDuplicated)
  })

  test('列表分頁：新增三筆，perPage=2 時第一頁兩筆、totalCount 至少 3', async () => {
    const company = await registerCompany()
    await createJobTitle(company.token)
    await createJobTitle(company.token)
    await createJobTitle(company.token)

    const listed = await call<JobTitleListShape>('/job-titles/main/list', company.token, { perPage: 2, currentPage: 1 })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data).toHaveLength(2)
    expect(listed.payload.data.pagination.totalCount).toBeGreaterThanOrEqual(3)
  })

  test('修改職稱：改名稱、代碼、說明與狀態', async () => {
    const company = await registerCompany()
    const created = await createJobTitle(company.token, { name: '舊名稱' })
    const renamed = uniqueCode('RENAMED')

    const updated = await call<JobTitleDetailShape>('/job-titles/main/update', company.token, {
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

  test('修改不存在的職稱回 422／300 與 not-found', async () => {
    const company = await registerCompany()
    const result = await call('/job-titles/main/update', company.token, {
      id: crypto.randomUUID(),
      code: uniqueCode('X'),
      name: '不存在',
      status: 'ACTIVE',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors[0]?.code).toBe(JobTitleErrorCode.NotFound)
  })

  test('★ 系統預設職稱不能被公司修改，回 not-found（不透露「其實存在」，§3.2）', async () => {
    const company = await registerCompany()
    const systemJobTitleId = await createSystemDefaultJobTitle()

    // 公司自己能查到系統預設職稱（含系統預設，見 find.repository.ts 檔頭）。
    const fetched = await call<JobTitleDetailShape | null>('/job-titles/main/get', company.token, {
      id: systemJobTitleId,
    })
    expect(fetched.payload.data?.isSystem).toBe(true)

    const updateResult = await call('/job-titles/main/update', company.token, {
      id: systemJobTitleId,
      code: uniqueCode('HACK'),
      name: '想改系統預設',
      status: 'ACTIVE',
    })
    expect(updateResult.status).toBe(422)
    expect(updateResult.payload.errors[0]?.code).toBe(JobTitleErrorCode.NotFound)

    const deleteResult = await call('/job-titles/main/delete', company.token, { id: systemJobTitleId })
    expect(deleteResult.status).toBe(422)
    expect(deleteResult.payload.errors[0]?.code).toBe(JobTitleErrorCode.NotFound)
  })

  test('軟刪除後同一個代碼可以再建立', async () => {
    const company = await registerCompany()
    const code = uniqueCode('REUSE')
    const created = await createJobTitle(company.token, { code })

    const deleted = await call<{ id: string }>('/job-titles/main/delete', company.token, {
      id: created.payload.data.id,
    })
    expect(deleted.status).toBe(200)

    const fetched = await call<JobTitleDetailShape | null>('/job-titles/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data).toBeNull()

    const recreated = await createJobTitle(company.token, { code })
    expect(recreated.status).toBe(200)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('B 公司看不到 A 公司自訂的職稱（§4.2），刪除回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await createJobTitle(companyA.token)

    const crossCompanyGet = await call<JobTitleDetailShape | null>('/job-titles/main/get', companyB.token, {
      id: created.payload.data.id,
    })
    expect(crossCompanyGet.payload.data).toBeNull()

    const crossCompanyDelete = await call('/job-titles/main/delete', companyB.token, { id: created.payload.data.id })
    const notFoundDelete = await call('/job-titles/main/delete', companyB.token, { id: crypto.randomUUID() })
    expect(crossCompanyDelete.status).toBe(notFoundDelete.status)
    expect(crossCompanyDelete.payload.errors).toEqual(notFoundDelete.payload.errors)
  })

  test('未帶 token 一律回 401／900', async () => {
    const response = await app.handle(
      new Request('http://localhost/job-titles/main/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'job-titles.main.list',
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
