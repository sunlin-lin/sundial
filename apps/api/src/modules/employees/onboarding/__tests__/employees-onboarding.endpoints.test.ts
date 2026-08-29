/**
 * 到職編排端點的整合測試（實作計畫 `05-employee-onboarding.md` Stage 4，§7.1）。
 *
 * **從 HTTP 打進去**：這是「建立員工」這個動作現在唯一的入口，envelope、`cmd`、遮罩、
 * 稽核與交易回滾全部要從這裡驗證（`/employees/main/create` 已移除，見 `employees/main/
 * __tests__/employees-main.endpoints.test.ts` 檔頭）。
 *
 * **本檔最重要的三條測試（依計畫回報要求逐一對應）：**
 * 1. `★ 角色不存在時整筆取消`——證明八張表**逐表**零新增，不是「查不到那個員工」。
 * 2. `username 全域重複時拒絕，且不touch既有帳號`——證明既有 `users` 列一個欄位都沒被動過。
 * 3. `密碼不進日誌`——故意讓建立失敗，確認 HTTP 回應與過程中寫進 console 的任何一行都沒有明文密碼。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import {
  auditLogs,
  companies,
  companyUserRoles,
  companyUsers,
  departments,
  DepartmentStatus,
  employeeDepartmentHistories,
  employeeEmployments,
  employees,
  employeeWithholdingSettings,
  roles,
  RoleStatus,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { employeesOnboardingRoutes } from '../employees-onboarding.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')
const cipher = createFieldCipher(
  createKeyRing({ keys: `v1:${testKey(31)}`, activeKeyId: 'v1', blindIndexKey: testKey(32) }),
)

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
  readonly expiresIn: number | null
}

type OnboardingDataShape = {
  readonly employeeId: string
  readonly employeeCode: string
  readonly employmentId: string
  readonly departmentHistoryId: string
  readonly withholdingSettingId: string
  readonly companyUserId: string
  readonly roles: readonly { readonly id: string; readonly roleId: string; readonly roleCode: string }[]
}

const identityByToken = new Map<string, VerifiedIdentity>()

const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () => Promise.resolve(new Set(['employees.onboarding.create'])),
}

const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employeesOnboardingRoutes({ db, cipher, clock })),
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

/** 建立一個公司與一位（尚未連結員工的）成員，回傳可用的 token（§7.3 的例外，理由同其他整合測試）。 */
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
    name: `到職測試公司-${companyId.slice(0, 8)}`,
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
    username: `onboarding-operator-${userId}`,
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

/** 建立一個部門，供到職編排的 `departmentId` 使用（§7.3 的例外：部門建立不是本檔要測的東西）。 */
const createDepartmentFixture = async (companyId: string): Promise<string> => {
  const departmentId = crypto.randomUUID()
  const now = clock.now()
  await database.insert(departments).values({
    id: departmentId,
    companyId,
    parentId: null,
    code: `DEPT-${departmentId.slice(0, 8)}`,
    name: '測試部門',
    description: null,
    status: DepartmentStatus.Active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  return departmentId
}

/** 建立一個可指派的角色（§7.3 的例外：角色建立不是本檔要測的東西）。 */
const createRoleFixture = async (companyId: string): Promise<string> => {
  const roleId = crypto.randomUUID()
  const now = clock.now()
  await database.insert(roles).values({
    id: roleId,
    companyId,
    code: `ROLE-${roleId.slice(0, 8)}`,
    name: '測試角色',
    description: null,
    isSystem: false,
    status: RoleStatus.Active,
    deletedAt: null,
    deletedSeq: 0,
    createdAt: now,
    updatedAt: now,
  })
  return roleId
}

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
const uniqueIdentityNumber = (): string =>
  `A${Math.floor(Math.random() * 900_000_000 + 100_000_000)
    .toString()
    .padStart(9, '1')}`
const uniqueUsername = (): string => `onboarding-${crypto.randomUUID()}`

/** 建立一份完整、可以直接送出的到職編排 body。 */
const onboardingBody = async (
  companyId: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  const departmentId = (overrides['departmentId'] as string | undefined) ?? (await createDepartmentFixture(companyId))
  const roleIds = (overrides['roleIds'] as readonly string[] | undefined) ?? [await createRoleFixture(companyId)]

  return {
    employeeCode: uniqueCode('EMP'),
    name: '王到職',
    gender: 'MALE',
    identityNumber: uniqueIdentityNumber(),
    birthday: '1990-05-21',
    phone: '0912345678',
    email: 'onboarding@example.com',
    address: '台北市信義區信義路五段7號',
    employmentTypeCode: 1,
    hireDate: '2026-09-01',
    withholdingMethodCode: 1,
    username: uniqueUsername(),
    initialPassword: 'InitPass123',
    ...overrides,
    departmentId,
    roleIds,
  }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employees/onboarding/create（整合，實作計畫 05-employee-onboarding.md Stage 4）', () => {
  test('一次成功建立員工、任職、部門歸屬、扣繳設定、登入帳號與角色', async () => {
    const company = await registerCompany()
    const body = await onboardingBody(company.companyId)

    const created = await call<OnboardingDataShape>('/employees/onboarding/create', company.token, body)

    expect(created.status).toBe(200)
    expect(created.payload.code).toBe('200')
    expect(created.payload.errors).toEqual([])
    expect(created.payload.data.employeeCode).toBe(body['employeeCode'] as string)
    expect(created.payload.data.roles).toHaveLength(1)
    expect(created.payload.data.roles[0]?.roleId).toBe((body['roleIds'] as readonly string[])[0])

    // 回應裡沒有密碼，也沒有其他明文個資（§5.1）。
    const serialized = JSON.stringify(created.payload)
    expect(serialized).not.toContain(body['initialPassword'])
    expect(serialized).not.toContain(body['identityNumber'])

    // 逐表確認真的各自新增了一列。
    const [employeeRow] = await database
      .select()
      .from(employees)
      .where(eq(employees.id, created.payload.data.employeeId))
    expect(employeeRow).toBeDefined()

    const [employmentRow] = await database
      .select()
      .from(employeeEmployments)
      .where(eq(employeeEmployments.id, created.payload.data.employmentId))
    expect(employmentRow?.employeeId).toBe(created.payload.data.employeeId)

    const [departmentHistoryRow] = await database
      .select()
      .from(employeeDepartmentHistories)
      .where(eq(employeeDepartmentHistories.id, created.payload.data.departmentHistoryId))
    expect(departmentHistoryRow?.employmentId).toBe(created.payload.data.employmentId)
    expect(departmentHistoryRow?.effectiveFrom).toBe('2026-09-01')

    const [withholdingRow] = await database
      .select()
      .from(employeeWithholdingSettings)
      .where(eq(employeeWithholdingSettings.id, created.payload.data.withholdingSettingId))
    expect(withholdingRow?.employeeId).toBe(created.payload.data.employeeId)
    expect(withholdingRow?.effectiveFrom).toBe('2026-09-01')

    const [companyUserRow] = await database
      .select()
      .from(companyUsers)
      .where(eq(companyUsers.id, created.payload.data.companyUserId))
    expect(companyUserRow?.employeeId).toBe(created.payload.data.employeeId)
    expect(companyUserRow?.status).toBe('ACTIVE')

    const [userRow] = await database
      .select()
      .from(users)
      .where(eq(users.id, companyUserRow?.userId ?? ''))
    expect(userRow?.username).toBe(body['username'] as string)
    expect(userRow?.mustChangePassword).toBe(true)
    // hash 不是明文密碼、也不是空字串。
    expect(userRow?.passwordHash).not.toBe(body['initialPassword'])
    expect(userRow?.passwordHash.length).toBeGreaterThan(0)

    const roleAssignments = await database
      .select()
      .from(companyUserRoles)
      .where(eq(companyUserRoles.companyUserId, created.payload.data.companyUserId))
    expect(roleAssignments).toHaveLength(1)
    expect(roleAssignments[0]?.roleId).toBe((body['roleIds'] as readonly string[])[0])
  })

  /**
   * ★ 整個 Stage 4 存在的理由：靠後的步驟（角色指派）失敗時，前面五步已經成功寫入的資料
   * **必須跟著整筆取消**，而不是「查不到那個員工」——逐表確認零新增，不是查一次 get。
   */
  test('★ 角色不存在時整筆取消：八張表逐表確認零新增', async () => {
    const company = await registerCompany()
    const body = await onboardingBody(company.companyId, { roleIds: [crypto.randomUUID()] })

    const result = await call('/employees/onboarding/create', company.token, body)

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe('company-users.roles.errors.role-not-found')

    // 逐表確認零新增——不是「查不到那個員工」，是每一張表都沒有多出任何一列。
    const employeeRows = await database.select().from(employees).where(eq(employees.companyId, company.companyId))
    expect(employeeRows).toHaveLength(0)

    const employmentRows = await database
      .select()
      .from(employeeEmployments)
      .where(eq(employeeEmployments.companyId, company.companyId))
    expect(employmentRows).toHaveLength(0)

    const departmentHistoryRows = await database
      .select()
      .from(employeeDepartmentHistories)
      .where(eq(employeeDepartmentHistories.companyId, company.companyId))
    expect(departmentHistoryRows).toHaveLength(0)

    const withholdingRows = await database
      .select()
      .from(employeeWithholdingSettings)
      .where(eq(employeeWithholdingSettings.companyId, company.companyId))
    expect(withholdingRows).toHaveLength(0)

    // company_users：只有 registerCompany() 建立的那一筆操作者帳號，沒有多出來的新帳號。
    const companyUserRows = await database
      .select()
      .from(companyUsers)
      .where(eq(companyUsers.companyId, company.companyId))
    expect(companyUserRows).toHaveLength(1)
    expect(companyUserRows[0]?.id).toBe(company.companyUserId)

    // users：這次請求送的 username 完全沒有寫進去。
    const userRows = await database
      .select()
      .from(users)
      .where(eq(users.username, body['username'] as string))
    expect(userRows).toHaveLength(0)

    const roleAssignmentRows = await database
      .select()
      .from(companyUserRoles)
      .where(eq(companyUserRoles.companyId, company.companyId))
    expect(roleAssignmentRows).toHaveLength(0)

    const auditRows = await database.select().from(auditLogs).where(eq(auditLogs.companyId, company.companyId))
    expect(auditRows).toHaveLength(0)
  })

  /**
   * §4.3：`username` 全域唯一。重複即拒絕，**不得連結到既有帳號、不得更動它的任何欄位**
   * （尤其是 `password_hash`）——這是計畫「二、username 全域唯一造成的跨租戶問題」的定案。
   */
  test('username 全域重複時拒絕，且既有 users 列一個欄位都沒被改動', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const sharedUsername = uniqueUsername()

    const firstBody = await onboardingBody(companyA.companyId, { username: sharedUsername })
    const first = await call<OnboardingDataShape>('/employees/onboarding/create', companyA.token, firstBody)
    expect(first.status).toBe(200)

    const [existingUserBefore] = await database.select().from(users).where(eq(users.username, sharedUsername))
    if (existingUserBefore === undefined) throw new Error('第一次建立後找不到既有帳號')

    // B 公司想用同一個帳號建立自己的員工，並且順手想覆寫密碼——這正是計畫要拒絕的情境。
    const secondBody = await onboardingBody(companyB.companyId, {
      username: sharedUsername,
      initialPassword: 'AttemptOverwrite999',
    })
    const second = await call('/employees/onboarding/create', companyB.token, secondBody)

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe('company-users.main.errors.username-taken')
    // §3.2：訊息不得透露這個帳號屬於哪一家公司。
    expect(JSON.stringify(second.payload)).not.toContain(companyA.companyId)

    // B 公司整筆都沒有留下（同上一條測試的邏輯，這裡只驗證 employees 與 users 兩張最關鍵的）。
    const employeeRowsB = await database.select().from(employees).where(eq(employees.companyId, companyB.companyId))
    expect(employeeRowsB).toHaveLength(0)

    // ★ 既有的 users 列一個欄位都沒被改動——尤其是 password_hash。
    const [existingUserAfter] = await database.select().from(users).where(eq(users.username, sharedUsername))
    expect(existingUserAfter).toEqual(existingUserBefore)
    expect(existingUserAfter?.passwordHash).toBe(existingUserBefore.passwordHash)

    // 而且 A 公司自己的員工／帳號安然無恙。
    const [companyUserA] = await database
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyA.companyId), eq(companyUsers.userId, existingUserBefore.id)))
    expect(companyUserA).toBeDefined()
  })

  /**
   * §5.1：密碼欄位不得出現在任何 log 或錯誤訊息中。
   *
   * 用上面「username 重複」這個真實會發生的失敗情境：攔截 console 的三個輸出方法，
   * 執行一次建立失敗的請求，確認 HTTP 回應與過程中寫進 console 的任何一行都沒有明文密碼。
   */
  test('密碼不進日誌：故意讓建立失敗，確認回應與 log 都沒有明文密碼', async () => {
    const company = await registerCompany()
    const sharedUsername = uniqueUsername()
    const plainPassword = 'DefinitelySecret777'

    const firstBody = await onboardingBody(company.companyId, {
      username: sharedUsername,
      initialPassword: plainPassword,
    })
    const first = await call('/employees/onboarding/create', company.token, firstBody)
    expect(first.status).toBe(200)

    // 本檔是全站對 `no-console` 規則的刻意例外：`shared/logger.ts` 是唯一允許呼叫 `console` 的
    // 生產程式碼，但這裡要驗證的正是「有沒有東西被寫進 console」，因此必須攔截它本身，
    // 不是繞過規則亂用。
    const captured: string[] = []
    /* eslint-disable no-console -- 見上方說明：本測試刻意攔截 console 以驗證沒有密碼外洩 */
    const originalLog = console.log
    const originalInfo = console.info
    const originalWarn = console.warn
    const originalError = console.error
    const capture =
      (original: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        captured.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
        original(...args)
      }
    console.log = capture(originalLog)
    console.info = capture(originalInfo)
    console.warn = capture(originalWarn)
    console.error = capture(originalError)

    let failingResult: { readonly status: number; readonly payload: EnvelopeShape<unknown> }
    try {
      const secondBody = await onboardingBody(company.companyId, {
        username: sharedUsername,
        initialPassword: plainPassword,
      })
      failingResult = await call('/employees/onboarding/create', company.token, secondBody)
    } finally {
      console.log = originalLog
      console.info = originalInfo
      console.warn = originalWarn
      console.error = originalError
    }
    /* eslint-enable no-console */

    expect(failingResult.status).toBe(409)
    expect(JSON.stringify(failingResult.payload)).not.toContain(plainPassword)

    const joinedLogs = captured.join('\n')
    expect(joinedLogs).not.toContain(plainPassword)
    // 連 hash 的樣式（Argon2id 前綴）都不該出現——密碼欄位整體都不該進 log。
    expect(joinedLogs).not.toContain('$argon2id$')
  })

  test('roleIds 為空陣列時被 body schema 擋下（UI §2.4：至少指派一個角色）', async () => {
    const company = await registerCompany()
    const body = await onboardingBody(company.companyId, { roleIds: [] })

    const result = await call('/employees/onboarding/create', company.token, body)
    expect(result.status).toBe(400)
    expect(result.payload.code).toBe('100')
    expect(result.payload.errors).toEqual([])
  })

  test('未帶 token 一律回 401／900', async () => {
    // 不呼叫 `onboardingBody()`：那支輔助函式會先在資料庫裡建立部門與角色 fixture，
    // 而這條測試要驗的是「連身分都沒有就被擋下」——請求在 schema 驗證通過、
    // 進入 `identityGuard` 時就該被擋，departmentId／roleIds 只需要是格式合法的 UUID，
    // 不需要真的存在。
    const response = await app.handle(
      new Request('http://localhost/employees/onboarding/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'employees.onboarding.create',
          locale: 'zh-TW',
          employeeCode: uniqueCode('EMP'),
          name: '王到職',
          gender: 'MALE',
          identityNumber: uniqueIdentityNumber(),
          birthday: '1990-05-21',
          phone: '0912345678',
          address: '台北市信義區信義路五段7號',
          employmentTypeCode: 1,
          hireDate: '2026-09-01',
          departmentId: crypto.randomUUID(),
          withholdingMethodCode: 1,
          username: uniqueUsername(),
          initialPassword: 'InitPass123',
          roleIds: [crypto.randomUUID()],
        }),
      }),
    )
    const payload: unknown = await response.json()
    if (!asEnvelope(payload)) throw new Error('未登入的回應不是 envelope 形狀')

    expect(response.status).toBe(401)
    expect(payload.code).toBe('900')
    expect(payload.expiresIn).toBeNull()
  })
})
