/**
 * 眷屬的端點測試（§7.1）。形狀比照 `withholding/main/__tests__/withholding-main.endpoints.test.ts`。
 *
 * **本模組沒有併發測試**：理由寫在 `db/schema/employee-dependents.ts` 檔頭——本表沒有 §4.3 的
 * 「有效期間不得重疊」處置，唯一要防的重複（同一員工同一身分證）靠資料庫唯一鍵直接擋，
 * 不需要 `FOR UPDATE` 來序列化併發請求，因此也沒有對應的併發測試（比照 `withholding`／
 * `labor-pension` 的模式：有鎖才需要併發測試）。
 */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import { companies, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { dependentsMainRoutes } from '../dependents-main.routes.ts'

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

type DependentDetailShape = {
  readonly id: string
  readonly employeeId: string
  readonly name: string
  readonly identityNumberMasked: string
  readonly birthdayMasked: string
  readonly status: string
  readonly endDate: string | null
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(new Set(['dependents.main.list', 'dependents.main.create', 'dependents.main.terminate'])),
}

const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')
const cipher = createFieldCipher(
  createKeyRing({ keys: `v1:${testKey(31)}`, activeKeyId: 'v1', blindIndexKey: testKey(32) }),
)

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(dependentsMainRoutes({ db, cipher, clock })),
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

describe('dependents/main endpoints (integration)', () => {
  test('新增眷屬成功，可由 list 讀回；身分證字號一律遮罩', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()

    const created = await call<DependentDetailShape>('/dependents/main/create', token, {
      employeeId,
      name: '測試配偶',
      identityNumber: 'A123456789',
      birthday: '1990-01-01',
      relationshipCode: 1,
      isStudent: false,
      isDisabled: false,
      isUnableToWork: false,
      isCohabiting: true,
      effectiveDate: '2024-01-01',
    })
    expect(created.status).toBe(200)
    expect(created.payload.data.status).toBe('ACTIVE')
    expect(created.payload.data.endDate).toBeNull()
    expect(created.payload.data.identityNumberMasked).toBe('*******789')
    expect(created.payload.data.identityNumberMasked).not.toContain('A123456')

    const listed = await call<{ data: DependentDetailShape[] }>('/dependents/main/list', token, {
      employeeId,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.data.map((item) => item.id)).toContain(created.payload.data.id)
  })

  test('同一員工重複新增同一身分證的眷屬回 409 identity-number-duplicated', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()
    const dependentInput = {
      employeeId,
      name: '測試子女',
      identityNumber: 'B123456789',
      birthday: '2010-05-01',
      relationshipCode: 4,
      isStudent: true,
      isDisabled: false,
      isUnableToWork: false,
      isCohabiting: true,
      effectiveDate: '2024-01-01',
    }

    const first = await call<DependentDetailShape>('/dependents/main/create', token, dependentInput)
    expect(first.status).toBe(200)

    const duplicate = await call('/dependents/main/create', token, dependentInput)
    expect(duplicate.status).toBe(409)
    expect(duplicate.payload.errors.map((error) => error.code)).toEqual([
      'dependents.main.errors.identity-number-duplicated',
    ])
  })

  test('目標員工不存在時回 422 employee-not-found', async () => {
    const { token } = await registerCompanyWithEmployee()
    const result = await call('/dependents/main/create', token, {
      employeeId: crypto.randomUUID(),
      name: '測試父親',
      identityNumber: 'C123456789',
      birthday: '1960-01-01',
      relationshipCode: 2,
      isStudent: false,
      isDisabled: false,
      isUnableToWork: false,
      isCohabiting: false,
      effectiveDate: '2024-01-01',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors.map((error) => error.code)).toEqual(['dependents.main.errors.employee-not-found'])
  })

  test('終止扶養成功；重複終止回 422 already-terminated', async () => {
    const { token, employeeId } = await registerCompanyWithEmployee()

    const created = await call<DependentDetailShape>('/dependents/main/create', token, {
      employeeId,
      name: '測試母親',
      identityNumber: 'D123456789',
      birthday: '1965-01-01',
      relationshipCode: 3,
      isStudent: false,
      isDisabled: false,
      isUnableToWork: false,
      isCohabiting: true,
      effectiveDate: '2024-01-01',
    })
    expect(created.status).toBe(200)

    const terminated = await call<DependentDetailShape>('/dependents/main/terminate', token, {
      id: created.payload.data.id,
      endDate: '2024-12-31',
    })
    expect(terminated.status).toBe(200)
    expect(terminated.payload.data.status).toBe('TERMINATED')
    expect(terminated.payload.data.endDate).toBe('2024-12-31')

    const repeated = await call('/dependents/main/terminate', token, {
      id: created.payload.data.id,
      endDate: '2025-01-01',
    })
    expect(repeated.status).toBe(422)
    expect(repeated.payload.errors.map((error) => error.code)).toEqual(['dependents.main.errors.already-terminated'])
  })

  test('終止不存在的眷屬回 422 not-found', async () => {
    const { token } = await registerCompanyWithEmployee()
    const result = await call('/dependents/main/terminate', token, {
      id: crypto.randomUUID(),
      endDate: '2024-12-31',
    })
    expect(result.status).toBe(422)
    expect(result.payload.errors.map((error) => error.code)).toEqual(['dependents.main.errors.not-found'])
  })
})
