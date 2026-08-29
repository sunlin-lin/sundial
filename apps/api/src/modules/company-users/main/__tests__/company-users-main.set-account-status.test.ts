/**
 * 啟用／停用登入帳號（`activateCompanyUserAccount`／`deactivateCompanyUserAccount`）的整合測試
 * （UI 定案 `docs/ui/20-employee-list.md` §3.5「可以管理登入帳號狀態」）。
 *
 * **直接呼叫模組入口，不透過 HTTP**：理由與 `company-users-main.reset-password.test.ts` 相同
 * ——這幾條測試要驗的是稽核紀錄的內容、狀態是否真的被換掉、冪等與自我操作檢查是否生效，
 * 這些在 service 層就回答得完整。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：這幾條測試的價值就在於驗真的有寫進去、且空操作真的
 * 沒有寫。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { auditLogs, companies, CompanyUserStatus, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { CompanyUserErrorCode } from '../company-users-main.errors.ts'
import { activateCompanyUserAccount, deactivateCompanyUserAccount } from '../company-users-main.service.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

let database: Database

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
})

/**
 * 建立一家公司、一位操作者（無 `employeeId`，比照系統管理者），以及一位員工與其登入帳號。
 * `targetStatus` 決定員工帳號的初始狀態，讓啟用／停用兩邊都能各自從正確的起始狀態測試。
 * §7.3 的例外理由與其他 DB 整合測試相同（見 `employments-main.audit.test.ts`）。
 */
const registerFixture = async (
  targetStatus: (typeof CompanyUserStatus)[keyof typeof CompanyUserStatus],
): Promise<{
  companyId: string
  operatorCompanyUserId: string
  employeeId: string
  employeeCompanyUserId: string
}> => {
  const companyId = crypto.randomUUID()
  const operatorUserId = crypto.randomUUID()
  const operatorCompanyUserId = crypto.randomUUID()
  const employeeId = crypto.randomUUID()
  const employeeUserId = crypto.randomUUID()
  const employeeCompanyUserId = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `帳號狀態測試公司-${companyId.slice(0, 8)}`,
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
  await database.insert(users).values([
    {
      id: operatorUserId,
      username: `account-status-operator-${operatorUserId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: employeeUserId,
      username: `account-status-employee-${employeeUserId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await database.insert(employees).values({
    id: employeeId,
    companyId,
    employeeCode: `E${employeeId.slice(0, 8)}`,
    name: '帳號狀態測試員工',
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
  await database.insert(companyUsers).values([
    {
      id: operatorCompanyUserId,
      companyId,
      userId: operatorUserId,
      employeeId: null,
      status: CompanyUserStatus.Active,
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: employeeCompanyUserId,
      companyId,
      userId: employeeUserId,
      employeeId,
      status: targetStatus,
      activatedAt: now,
      deactivatedAt: targetStatus === CompanyUserStatus.Inactive ? now : null,
      createdAt: now,
      updatedAt: now,
    },
  ])

  return { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId }
}

const readCompanyUserStatus = async (companyUserId: string) => {
  const rows = await database
    .select({
      status: companyUsers.status,
      activatedAt: companyUsers.activatedAt,
      deactivatedAt: companyUsers.deactivatedAt,
    })
    .from(companyUsers)
    .where(eq(companyUsers.id, companyUserId))
  const row = rows[0]
  if (row === undefined) throw new Error('測試斷言失敗：找不到這個 companyUserId')
  return row
}

/** 顯式列出欄位而不是 `select()` 全撈（§2）。 */
const readAuditLogs = (companyId: string, subjectId: string) =>
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
    .where(eq(auditLogs.companyId, companyId))
    .then((rows) => rows.filter((row) => row.subjectId === subjectId))

const parseChanges = (raw: unknown): readonly { field: string; before?: unknown; after?: unknown }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly { field: string; before?: unknown; after?: unknown }[]

describe('company-users/main 啟用／停用登入帳號（UI 定案 20-employee-list.md §3.5）', () => {
  test('★ 停用一個生效帳號：狀態真的被換掉，且留下一筆帶前後值的稽核', async () => {
    const { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId } = await registerFixture(
      CompanyUserStatus.Active,
    )

    const result = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId },
      clock.now(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('不會走到這裡')
    expect(result.value).toEqual({ companyUserId: employeeCompanyUserId, status: CompanyUserStatus.Inactive })

    const row = await readCompanyUserStatus(employeeCompanyUserId)
    expect(row.status).toBe(CompanyUserStatus.Inactive)
    expect(row.deactivatedAt).toBe(clock.now())

    const logs = await readAuditLogs(companyId, employeeCompanyUserId)
    expect(logs).toHaveLength(1)
    const log = logs[0]
    if (log === undefined) throw new Error('稽核紀錄不存在')
    expect(log.action).toBe('company-users.main.deactivate')
    expect(log.actorCompanyUserId).toBe(operatorCompanyUserId)
    expect(log.subjectTable).toBe('company_users')
    const statusChange = parseChanges(log.changes).find((change) => change.field === 'status')
    expect(statusChange).toEqual({ field: 'status', before: 'ACTIVE', after: 'INACTIVE' })
  })

  test('重複停用一個已經停用的帳號：視為空操作，回成功但不重複記稽核', async () => {
    const { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId } = await registerFixture(
      CompanyUserStatus.Inactive,
    )

    const result = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId },
      clock.now(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('不會走到這裡')
    expect(result.value.status).toBe(CompanyUserStatus.Inactive)

    const logs = await readAuditLogs(companyId, employeeCompanyUserId)
    expect(logs).toHaveLength(0)
  })

  test('操作者不得停用自己的帳號：回 Conflict，不寫入、不記稽核', async () => {
    const { companyId, operatorCompanyUserId } = await registerFixture(CompanyUserStatus.Active)

    // 操作者對「自己」動用：employeeId 帶操作者自己的帳號沒有 employeeId 可用，
    // 因此直接把操作者的 companyUserId 塞進另一位「員工」列，模擬操作者本人同時是員工帳號的情境。
    const selfEmployeeId = crypto.randomUUID()
    const now = clock.now()
    await database.insert(employees).values({
      id: selfEmployeeId,
      companyId,
      employeeCode: `E${selfEmployeeId.slice(0, 8)}`,
      name: '操作者本人（同時是員工）',
      gender: 'FEMALE',
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
    await database
      .update(companyUsers)
      .set({ employeeId: selfEmployeeId })
      .where(eq(companyUsers.id, operatorCompanyUserId))

    const result = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId: selfEmployeeId },
      now,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不會走到這裡')
    expect(result.errors[0]?.code).toBe(CompanyUserErrorCode.CannotChangeOwnAccountStatus)

    const row = await readCompanyUserStatus(operatorCompanyUserId)
    expect(row.status).toBe(CompanyUserStatus.Active)
    const logs = await readAuditLogs(companyId, operatorCompanyUserId)
    expect(logs).toHaveLength(0)
  })

  test('停用查無帳號的員工（含跨公司）回 company-user-not-found', async () => {
    const { companyId, operatorCompanyUserId } = await registerFixture(CompanyUserStatus.Active)
    const other = await registerFixture(CompanyUserStatus.Active)

    const neverExisted = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId: crypto.randomUUID() },
      clock.now(),
    )
    expect(neverExisted.ok).toBe(false)
    if (neverExisted.ok) throw new Error('不會走到這裡')
    expect(neverExisted.errors[0]?.code).toBe(CompanyUserErrorCode.CompanyUserNotFound)

    // 跨公司：拿別家公司真實存在的 employeeId，一樣回「找不到」（§3.2 不可區分）。
    const crossCompany = await deactivateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId: other.employeeId },
      clock.now(),
    )
    expect(crossCompany.ok).toBe(false)
    if (crossCompany.ok) throw new Error('不會走到這裡')
    expect(crossCompany.errors[0]?.code).toBe(CompanyUserErrorCode.CompanyUserNotFound)
  })

  test('★ 啟用一個停用中的帳號：狀態真的被換掉，且留下一筆帶前後值的稽核', async () => {
    const { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId } = await registerFixture(
      CompanyUserStatus.Inactive,
    )

    const result = await activateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId },
      clock.now(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('不會走到這裡')
    expect(result.value).toEqual({ companyUserId: employeeCompanyUserId, status: CompanyUserStatus.Active })

    const row = await readCompanyUserStatus(employeeCompanyUserId)
    expect(row.status).toBe(CompanyUserStatus.Active)
    expect(row.deactivatedAt).toBe(null)
    expect(row.activatedAt).toBe(clock.now())

    const logs = await readAuditLogs(companyId, employeeCompanyUserId)
    expect(logs).toHaveLength(1)
    const log = logs[0]
    if (log === undefined) throw new Error('稽核紀錄不存在')
    expect(log.action).toBe('company-users.main.activate')
    const statusChange = parseChanges(log.changes).find((change) => change.field === 'status')
    expect(statusChange).toEqual({ field: 'status', before: 'INACTIVE', after: 'ACTIVE' })
  })

  test('重複啟用一個已經啟用的帳號：視為空操作，回成功但不重複記稽核', async () => {
    const { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId } = await registerFixture(
      CompanyUserStatus.Active,
    )

    const result = await activateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId },
      clock.now(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('不會走到這裡')
    expect(result.value.status).toBe(CompanyUserStatus.Active)

    const logs = await readAuditLogs(companyId, employeeCompanyUserId)
    expect(logs).toHaveLength(0)
  })

  test('操作者不得啟用自己的帳號：回 Conflict，不寫入、不記稽核', async () => {
    const { companyId, operatorCompanyUserId } = await registerFixture(CompanyUserStatus.Active)
    const selfEmployeeId = crypto.randomUUID()
    const now = clock.now()
    await database.insert(employees).values({
      id: selfEmployeeId,
      companyId,
      employeeCode: `E${selfEmployeeId.slice(0, 8)}`,
      name: '操作者本人（同時是員工）',
      gender: 'FEMALE',
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
    await database
      .update(companyUsers)
      .set({ employeeId: selfEmployeeId })
      .where(eq(companyUsers.id, operatorCompanyUserId))

    const result = await activateCompanyUserAccount(
      database,
      companyId,
      operatorCompanyUserId,
      { employeeId: selfEmployeeId },
      now,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不會走到這裡')
    expect(result.errors[0]?.code).toBe(CompanyUserErrorCode.CannotChangeOwnAccountStatus)

    const logs = await readAuditLogs(companyId, operatorCompanyUserId)
    expect(logs).toHaveLength(0)
  })
})
