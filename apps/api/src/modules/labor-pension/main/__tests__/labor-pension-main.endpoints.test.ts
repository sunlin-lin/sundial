/**
 * 勞退設定的端點測試（§7.1）。形狀比照 `withholding/main/__tests__/withholding-main.endpoints.test.ts`。
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
import { laborPensionMainRoutes } from '../labor-pension-main.routes.ts'

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

type LaborPensionDetailShape = {
  readonly id: string
  readonly employeeId: string
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () => Promise.resolve(new Set(['labor-pension.main.list', 'labor-pension.main.create'])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(laborPensionMainRoutes({ db, clock })),
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

const registerCompanyWithEmployee = async (): Promise<{
  companyId: string
  token: string
  employeeId: string
  companyUserId: string
}> => {
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
  return { companyId, token, employeeId, companyUserId }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('labor-pension/main endpoints (integration)', () => {
  test('新增勞退設定成功，可由 list 讀回', async () => {
    const { token, employeeId, companyUserId } = await registerCompanyWithEmployee()

    const created = await call<LaborPensionDetailShape>('/labor-pension/main/create', token, {
      employeeId,
      voluntaryContributionRate: '0.0600',
      effectiveFrom: '2024-01-01',
    })
    expect(created.status).toBe(200)
    expect(created.payload.data.voluntaryContributionRate).toBe('0.0600')
    expect(created.payload.data.effectiveTo).toBeNull()
    expect(created.payload.data.createdBy).toBe(companyUserId)

    const listed = await call<{ data: LaborPensionDetailShape[] }>('/labor-pension/main/list', token, {
      employeeId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data.map((item) => item.id)).toContain(created.payload.data.id)
  })

  test('重疊的勞退設定期間回 422 period-overlap；不重疊的可以再新增一筆', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()

    const first = await call<LaborPensionDetailShape>('/labor-pension/main/create', token, {
      employeeId,
      voluntaryContributionRate: '0.0600',
      effectiveFrom: '2024-01-01',
      effectiveTo: '2024-06-30',
    })
    expect(first.status).toBe(200)

    const overlapping = await call('/labor-pension/main/create', token, {
      employeeId,
      voluntaryContributionRate: '0.0100',
      effectiveFrom: '2024-03-01',
    })
    expect(overlapping.status).toBe(422)
    expect(overlapping.payload.errors.map((error) => error.code)).toEqual(['labor-pension.main.errors.period-overlap'])

    const nonOverlapping = await call<LaborPensionDetailShape>('/labor-pension/main/create', token, {
      employeeId,
      voluntaryContributionRate: '0.0100',
      effectiveFrom: '2024-07-01',
    })
    expect(nonOverlapping.status).toBe(200)
  })

  test('目標員工不存在時回 422 employee-not-found', async () => {
    const { token } = await registerCompanyWithEmployee()
    const result = await call('/labor-pension/main/create', token, {
      employeeId: crypto.randomUUID(),
      voluntaryContributionRate: '0.0600',
      effectiveFrom: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors.map((error) => error.code)).toEqual(['labor-pension.main.errors.employee-not-found'])
  })
})
