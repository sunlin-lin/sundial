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
 *
 * **沒有「建立員工的稽核」測試**（實作計畫 `05-employee-onboarding.md` §4.2）：
 * `/employees/main/create` 已移除，「建立員工這個動作會不會留下 `action='employees.main.create'`
 * 的稽核」這個問題現在由 `employees/onboarding/__tests__/employees-onboarding.endpoints.test.ts`
 * 從 `/employees/onboarding/create` 這個真正的 HTTP 入口驗證（那裡的身分推導路徑
 * `identityGuard → requestContext → toOnboardingContext` 與這裡逐字同構）。**下面 update／delete
 * 兩類測試仍然需要一位已存在的員工**，做法是直接呼叫業務動作 `createEmployee`
 * （`employees-main.service.ts` 仍然 export 它，§0.4 允許「沒有端點的業務動作」）；
 * update／delete 本身的稽核仍然是從 HTTP 打進去驗證的，不受影響。
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
import { createEmployee, type GenderValue } from '../employees-main.service.ts'

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
type EmployeeDetailShape = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly identityNumberMasked: string
  readonly birthdayMasked: string
  readonly phoneMasked: string
  readonly addressMasked: string
}

const identityByToken = new Map<string, VerifiedIdentity>()

/** §7.3 禁止 mock 掉被測邏輯本身，而 token 驗證屬於尚未落地／不是本檔要測的 `sessions` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(new Set(['employees.main.update', 'employees.main.delete', 'employees.main.get'])),
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
 * 建立一位員工作為 update／delete 稽核測試的前置資料（§7.3：直接呼叫業務動作）。
 * 回傳形狀比照 `call<EmployeeDetailShape>(...)`，讓下面沿用既有斷言寫法。
 */
const createEmployeeFixture = async (
  company: { readonly companyId: string; readonly companyUserId: string },
  body: ReturnType<typeof profileBody>,
): Promise<{ readonly status: 200; readonly payload: { readonly data: EmployeeDetailShape } }> => {
  const result = await createEmployee(
    { db: database, cipher, clock, companyId: company.companyId, operatorCompanyUserId: company.companyUserId },
    {
      employeeCode: body['employeeCode'] as string,
      name: body['name'] as string,
      gender: body['gender'] as GenderValue,
      identityNumber: body['identityNumber'] as string,
      birthday: body['birthday'] as string,
      phone: body['phone'] as string,
      email: (body['email'] as string | undefined) ?? null,
      address: body['address'] as string,
    },
  )
  if (!result.ok) throw new Error(`測試 fixture 建立員工失敗：${JSON.stringify(result.errors)}`)
  return {
    status: 200,
    payload: {
      data: {
        id: result.value.id,
        employeeCode: result.value.employeeCode,
        name: result.value.name,
        identityNumberMasked: result.value.identityNumberMasked,
        birthdayMasked: result.value.birthdayMasked,
        phoneMasked: result.value.phoneMasked,
        addressMasked: result.value.addressMasked,
      },
    },
  }
}

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
  // 沒有「建立員工：恰好新增一筆稽核」測試：`/employees/main/create` 已移除，等效覆蓋在
  // `employees/onboarding/__tests__/employees-onboarding.endpoints.test.ts`（見本檔檔頭）。

  test('★ 改員工編號：changes 有 employeeCode 的前後值，且稽核恰好新增一筆', async () => {
    const company = await registerCompany()
    const body = profileBody({ employeeCode: 'E001' })
    const created = await createEmployeeFixture(company, body)
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
    const created = await createEmployeeFixture(company, body)

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

  /**
   * ★ gap2 定案的實際場景：請求根本**沒有送**身分證、生日、手機、地址（不是送了同樣的值），
   * 前端不再需要把 `get` 回的遮罩值原樣讀出來、拼回一個「完整值」才能改姓名。
   *
   * 與上面「★ 只改姓名」的差別：那一條測的是全量提交下明文比對能不能正確判斷「沒有變更」；
   * 這一條測的是請求本身**省略這幾個欄位時，服務層與稽核仍然得出一模一樣的結論**——
   * 兩條合起來才涵蓋「全量提交」與「省略提交」兩種呼叫端寫法。
   */
  test('★ 省略身分證／生日／手機／地址：更新成功、這四欄維持原值，且 changes 不含 identityNumber', async () => {
    const company = await registerCompany()
    const body = profileBody()
    const created = await createEmployeeFixture(company, body)

    // body 裡刻意不帶 identityNumber／birthday／phone／address 四欄。
    const updated = await call<EmployeeDetailShape>('/employees/main/update', company.token, {
      id: created.payload.data.id,
      employeeCode: body.employeeCode,
      name: '王大明',
      gender: body.gender,
      email: body.email,
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.data.name).toBe('王大明')

    // 四個遮罩欄位維持建立時的原值——省略代表不變更，不是清空或改壞。
    expect(updated.payload.data.identityNumberMasked).toBe(created.payload.data.identityNumberMasked)
    expect(updated.payload.data.birthdayMasked).toBe(created.payload.data.birthdayMasked)
    expect(updated.payload.data.phoneMasked).toBe(created.payload.data.phoneMasked)
    expect(updated.payload.data.addressMasked).toBe(created.payload.data.addressMasked)

    const rows = await readAuditLogs(created.payload.data.id)
    const updateRow = rows.find((row) => row.action === 'employees.main.update')
    const changes = parseChanges(updateRow?.changes)

    // 稽核紀錄裡只有姓名這一項變更；身分證、生日、手機、地址完全不出現在 changes 裡
    // ——不是「記了但值是 unchanged」，是根本沒有這個 field 項目。
    expect(changes).toEqual([{ field: 'name', before: '王小明', after: '王大明' }])
    expect(changes.map((change) => change.field)).not.toContain('identityNumber')
    expect(changes.map((change) => change.field)).not.toContain('birthday')
    expect(changes.map((change) => change.field)).not.toContain('phone')
    expect(changes.map((change) => change.field)).not.toContain('address')
    expect(JSON.stringify(changes)).not.toContain(body.identityNumber)
  })

  test('刪除員工：changes 的 after 為 null，identityNumber 等仍只記 changed', async () => {
    const company = await registerCompany()
    const body = profileBody()
    const created = await createEmployeeFixture(company, body)

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
