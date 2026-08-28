/**
 * 員工主檔的稽核整合測試（稽核計畫 §7 Stage 2 三筆欠帳之一，§6.2 要求的整合測試）。
 *
 * **從 HTTP 打進去**（與 `employees-main.endpoints.test.ts` 同一種組裝，故意重複那份最小組裝
 * 而不是共用：每個整合測試檔自成一份，符合本檔案樹既有的慣例，見 `sessions-main.endpoints.test.ts`
 * 與 `employees-main.endpoints.test.ts` 互不共用組裝碼）。之所以要從 HTTP 打進去而不是直接呼叫
 * service：`actor_company_user_id` 必須來自已驗證身分，而那條推導路徑（`identityGuard` →
 * `requestContext` → `toEmployeeContext`）只有整條路徑跑過才驗得到。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：這幾條測試的全部價值就在於驗真的有寫進去。
 */
import { Buffer } from 'node:buffer'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import { AuditActorType, auditLogs, companies, companyUsers, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { employeesMainRoutes } from '../employees-main.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')
const cipher = createFieldCipher(
  createKeyRing({ keys: `v1:${testKey(41)}`, activeKeyId: 'v1', blindIndexKey: testKey(42) }),
)

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string; readonly msg: string; readonly data?: Record<string, unknown> }
type EnvelopeShape<TData> = {
  readonly code: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
}
type EmployeeDetailShape = { readonly id: string; readonly employeeCode: string; readonly name: string }

const identityByToken = new Map<string, VerifiedIdentity>()

/** §7.3 禁止 mock 掉被測邏輯本身，而 token 驗證屬於尚未落地／不是本檔要測的 `sessions` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set(['employees.main.create', 'employees.main.update', 'employees.main.delete', 'employees.main.get']),
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
        .use(employeesMainRoutes({ db, cipher, clock })),
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

/** 建立一個公司與一位成員，回傳可用的 token（§7.3 的例外：`companies`／`users`／`company_users` 尚無正式流程）。 */
const registerCompany = async (): Promise<{ companyId: string; companyUserId: string; token: string }> => {
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
    username: `audit-test-${userId}`,
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
  return { companyId, companyUserId, token }
}

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
const uniqueIdentityNumber = (): string =>
  `A${Math.floor(Math.random() * 900_000_000 + 100_000_000)
    .toString()
    .padStart(9, '1')}`

const profileBody = (overrides: Record<string, unknown> = {}) => ({
  employeeCode: uniqueCode('EMP'),
  name: '王小明',
  gender: 'MALE',
  identityNumber: uniqueIdentityNumber(),
  birthday: '1990-05-21',
  phone: '0912345678',
  email: 'someone@example.com',
  address: '台北市信義區信義路五段7號',
  ...overrides,
})

/**
 * 顯式列出欄位而不是 `select()` 全撈（§2）。
 *
 * 用 `subjectId` 過濾就足夠精準：`employees.id` 是全域隨機 uuid，不會與其他測試撞在一起，
 * 因此不必再額外帶 `companyId` 條件（§7.4 的測試隔離已經由「每個測試自己的員工 id」達成）。
 */
const readAuditLogs = (subjectId: string) =>
  database
    .select({
      actorTypeCode: auditLogs.actorTypeCode,
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
    })
    .from(auditLogs)
    .where(eq(auditLogs.subjectId, subjectId))

const parseChanges = (raw: unknown): readonly { field: string; before?: unknown; after?: unknown; changed?: true }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly {
    field: string
    before?: unknown
    after?: unknown
    changed?: true
  }[]

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employees/main 稽核整合（稽核計畫 §7 Stage 2）', () => {
  test('建立員工：恰好新增一筆稽核，action／subject／actor 逐項正確', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)
    expect(created.status).toBe(200)

    const rows = await readAuditLogs(created.payload.data.id)
    expect(rows).toHaveLength(1)

    const row = rows[0]
    expect(row?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(row?.actorCompanyUserId).toBe(company.companyUserId)
    expect(row?.action).toBe('employees.main.create')
    expect(row?.subjectTable).toBe('employees')
    expect(row?.subjectId).toBe(created.payload.data.id)

    const changes = parseChanges(row?.changes)
    // 新增事件：employeeCode／name／gender 記前後值（before 為 null），identityNumber 等
    // presence 級欄位只記 changed:true，且**不含**明文（§5.1、稽核計畫 §4.3）。
    expect(changes).toContainEqual({ field: 'employeeCode', before: null, after: body.employeeCode })
    expect(changes).toContainEqual({ field: 'identityNumber', changed: true })
    expect(JSON.stringify(changes)).not.toContain(body.identityNumber)
  })

  test('★ 改員工編號：changes 有 employeeCode 的前後值，且稽核恰好新增一筆', async () => {
    const company = await registerCompany()
    const body = profileBody({ employeeCode: 'E001' })
    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)
    const beforeCount = (await readAuditLogs(created.payload.data.id)).length

    const updated = await call<EmployeeDetailShape>('/employees/main/update', company.token, {
      id: created.payload.data.id,
      ...profileBody({ ...body, employeeCode: 'E002' }),
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.data.employeeCode).toBe('E002')

    const rows = await readAuditLogs(created.payload.data.id)
    expect(rows).toHaveLength(beforeCount + 1)

    const updateRow = rows.find((row) => row.action === 'employees.main.update')
    expect(updateRow?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(updateRow?.actorCompanyUserId).toBe(company.companyUserId)
    expect(updateRow?.subjectTable).toBe('employees')
    expect(updateRow?.subjectId).toBe(created.payload.data.id)

    const changes = parseChanges(updateRow?.changes)
    expect(changes).toContainEqual({ field: 'employeeCode', before: 'E001', after: 'E002' })
  })

  /**
   * ★ 稽核計畫 §4.4 的核心保證：全量提交只改姓名時，身分證這種 `presence` 級欄位不得出現在
   * `changes` 裡——因為變更判定必須基於明文，而不是每次寫入都不同的密文。
   */
  test('★ 只改姓名：changes 不含 identityNumber 等 presence 級欄位', async () => {
    const company = await registerCompany()
    const body = profileBody()
    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)

    const updated = await call<EmployeeDetailShape>('/employees/main/update', company.token, {
      id: created.payload.data.id,
      ...profileBody({ ...body, name: '王大明' }),
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.data.name).toBe('王大明')

    const rows = await readAuditLogs(created.payload.data.id)
    const updateRow = rows.find((row) => row.action === 'employees.main.update')
    const changes = parseChanges(updateRow?.changes)

    expect(changes).toEqual([{ field: 'name', before: '王小明', after: '王大明' }])
    expect(changes.map((change) => change.field)).not.toContain('identityNumber')
  })

  test('刪除員工：changes 的 after 為 null，identityNumber 等仍只記 changed', async () => {
    const company = await registerCompany()
    const body = profileBody()
    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)

    const deleted = await call<{ id: string }>('/employees/main/delete', company.token, {
      id: created.payload.data.id,
    })
    expect(deleted.status).toBe(200)

    const rows = await readAuditLogs(created.payload.data.id)
    const deleteRow = rows.find((row) => row.action === 'employees.main.delete')
    expect(deleteRow).toBeDefined()
    expect(deleteRow?.subjectTable).toBe('employees')
    expect(deleteRow?.subjectId).toBe(created.payload.data.id)

    const changes = parseChanges(deleteRow?.changes)
    expect(changes).toContainEqual({ field: 'employeeCode', before: body.employeeCode, after: null })
    expect(changes).toContainEqual({ field: 'identityNumber', changed: true })
    expect(JSON.stringify(changes)).not.toContain(body.identityNumber)
  })
})
