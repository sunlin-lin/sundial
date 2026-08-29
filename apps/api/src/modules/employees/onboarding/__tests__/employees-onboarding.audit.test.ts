/**
 * 到職編排的稽核整合測試（實作計畫 `05-employee-onboarding.md` §6，稽核計畫 §5）。
 *
 * **從 HTTP 打進去**（理由與 `employees/main/__tests__/employees-main.audit.test.ts` 相同：
 * `actor_company_user_id` 必須來自已驗證身分，那條推導路徑只有整條打過才驗得到）。
 *
 * 本檔驗證計畫 §6 明列的那一批異動，在一次到職編排裡**各自恰好留下一筆稽核**：
 * 員工建立、任職建立、部門歸屬建立、扣繳設定建立、帳號建立、角色指派——共六筆，
 * 全部落在同一個交易、同一個時間戳。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import {
  AuditActorType,
  auditLogs,
  companies,
  companyUsers,
  departments,
  DepartmentStatus,
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
  createKeyRing({ keys: `v1:${testKey(51)}`, activeKeyId: 'v1', blindIndexKey: testKey(52) }),
)

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

type ErrorItemShape = { readonly code: string; readonly msg: string; readonly data?: Record<string, unknown> }
type EnvelopeShape<TData> = { readonly code: string; readonly errors: readonly ErrorItemShape[]; readonly data: TData }
type OnboardingDataShape = {
  readonly employeeId: string
  readonly employmentId: string
  readonly departmentHistoryId: string
  readonly withholdingSettingId: string
  readonly companyUserId: string
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
    name: `到職稽核測試公司-${companyId.slice(0, 8)}`,
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
    username: `onboarding-audit-operator-${userId}`,
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

const readAuditLogs = (companyId: string) =>
  database
    .select({
      actorTypeCode: auditLogs.actorTypeCode,
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.companyId, companyId))

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employees/onboarding 稽核整合（實作計畫 05-employee-onboarding.md §6）', () => {
  test('一次成功建立，恰好留下六筆稽核，逐筆 action／subject／actor 正確，且不含密碼', async () => {
    const company = await registerCompany()
    const departmentId = await createDepartmentFixture(company.companyId)
    const roleId = await createRoleFixture(company.companyId)
    const plainPassword = 'AuditTestPass123'

    const created = await call<OnboardingDataShape>('/employees/onboarding/create', company.token, {
      employeeCode: uniqueCode('EMP'),
      name: '王稽核',
      gender: 'MALE',
      identityNumber: uniqueIdentityNumber(),
      birthday: '1990-05-21',
      phone: '0912345678',
      address: '台北市信義區信義路五段7號',
      employmentTypeCode: 1,
      hireDate: '2026-09-01',
      departmentId,
      withholdingMethodCode: 1,
      username: `onboarding-audit-${crypto.randomUUID()}`,
      initialPassword: plainPassword,
      roleIds: [roleId],
    })
    expect(created.status).toBe(200)

    const rows = await readAuditLogs(company.companyId)
    expect(rows).toHaveLength(6)

    // 六筆全部同一個操作時間、同一個操作者（同一個交易，計畫 §3.3）。
    const distinctTimestamps = new Set(rows.map((row) => row.createdAt))
    expect(distinctTimestamps.size).toBe(1)
    for (const row of rows) {
      expect(row.actorTypeCode).toBe(AuditActorType.CompanyUser)
      expect(row.actorCompanyUserId).toBe(company.companyUserId)
    }

    const byAction = new Map(rows.map((row) => [row.action, row]))

    const employeeCreate = byAction.get('employees.main.create')
    expect(employeeCreate?.subjectTable).toBe('employees')
    expect(employeeCreate?.subjectId).toBe(created.payload.data.employeeId)

    const employmentCreate = byAction.get('employments.main.create')
    expect(employmentCreate?.subjectTable).toBe('employee_employments')
    expect(employmentCreate?.subjectId).toBe(created.payload.data.employmentId)

    const departmentHistoryCreate = byAction.get('employments.department-histories.create')
    expect(departmentHistoryCreate?.subjectTable).toBe('employee_department_histories')
    expect(departmentHistoryCreate?.subjectId).toBe(created.payload.data.departmentHistoryId)

    const withholdingCreate = byAction.get('withholding.main.create')
    expect(withholdingCreate?.subjectTable).toBe('employee_withholding_settings')
    expect(withholdingCreate?.subjectId).toBe(created.payload.data.withholdingSettingId)

    const accountCreate = byAction.get('company-users.main.create')
    expect(accountCreate?.subjectTable).toBe('company_users')
    expect(accountCreate?.subjectId).toBe(created.payload.data.companyUserId)
    // ★ 帳號建立的稽核只記狀態，連 presence 級的密碼欄位都沒有（§5.1）。
    expect(JSON.stringify(accountCreate?.changes)).toEqual(
      JSON.stringify([{ field: 'status', before: null, after: 'ACTIVE' }]),
    )

    const roleAssign = byAction.get('company-users.roles.create')
    expect(roleAssign?.subjectTable).toBe('company_users')
    expect(roleAssign?.subjectId).toBe(created.payload.data.companyUserId)

    // ★ 六筆稽核的 `changes` 全部序列化後，一段明文密碼、一段 hash 樣式都找不到。
    const allChanges = JSON.stringify(rows.map((row) => row.changes))
    expect(allChanges).not.toContain(plainPassword)
    expect(allChanges).not.toContain('$argon2id$')
  })
})
