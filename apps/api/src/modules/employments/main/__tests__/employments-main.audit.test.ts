/**
 * 任職主檔與離職流程的稽核整合測試（實作計畫 `plans/05-employee-onboarding.md` §6、§7）。
 *
 * **直接呼叫模組入口**（`createEmployment`／`leaveEmployment`），不透過 HTTP：理由與
 * `company-users/roles/__tests__/company-users-roles.audit.test.ts` 相同——這兩支動作要驗的是
 * 「稽核紀錄的內容與筆數」，那在 service 層就回答得完整。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：這幾條測試的全部價值就在於驗真的有寫進去。
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { auditLogs, companies, CompanyUserStatus, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { createEmployment, leaveEmployment } from '../employments-main.service.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'

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
 * 建立一家公司、一位操作者，以及一位**已有生效公司帳號**的員工（供離職流程驗證帳號同步停用）。
 * §7.3 的例外理由與其他 DB 整合測試相同（見 `employments-main.concurrency.test.ts`）。
 */
const registerFixture = async (): Promise<{
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
    name: `稽核測試公司-${companyId.slice(0, 8)}`,
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
      username: `employments-audit-operator-${operatorUserId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: employeeUserId,
      username: `employments-audit-employee-${employeeUserId}`,
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
    name: '稽核測試員工',
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
      status: CompanyUserStatus.Active,
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ])

  return { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId }
}

/** 顯式列出欄位而不是 `select()` 全撈（§2）。 */
const readAuditLogs = (companyId: string, subjectTable: string, subjectId: string) =>
  database
    .select({
      actorTypeCode: auditLogs.actorTypeCode,
      actorCompanyUserId: auditLogs.actorCompanyUserId,
      action: auditLogs.action,
      subjectTable: auditLogs.subjectTable,
      subjectId: auditLogs.subjectId,
      changes: auditLogs.changes,
      effectiveDate: auditLogs.effectiveDate,
    })
    .from(auditLogs)
    .where(eq(auditLogs.companyId, companyId))
    .then((rows) => rows.filter((row) => row.subjectTable === subjectTable && row.subjectId === subjectId))

const parseChanges = (raw: unknown): readonly { field: string; before?: unknown; after?: unknown; changed?: true }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly {
    field: string
    before?: unknown
    after?: unknown
    changed?: true
  }[]

describe('employments/main 稽核整合（計畫 §6、§7）', () => {
  test('★ 新增任職留下一筆稽核，changes 帶完整的新值', async () => {
    const { companyId, operatorCompanyUserId, employeeId } = await registerFixture()
    const context: EmploymentsMainContext = { db: database, clock, companyId, operatorCompanyUserId }

    const created = await createEmployment(context, {
      employeeId,
      employmentTypeCode: 1,
      employmentNatureCode: null,
      hireDate: '2024-01-01',
    })
    if (!created.ok) throw new Error('建立任職失敗，測試前置條件不成立')

    const logs = await readAuditLogs(companyId, 'employee_employments', created.value.id)
    expect(logs.length).toBe(1)
    const [log] = logs
    if (log === undefined) throw new Error('稽核紀錄不存在')
    expect(log.action).toBe('employments.main.create')
    expect(log.actorCompanyUserId).toBe(operatorCompanyUserId)
    const changes = parseChanges(log.changes)
    const hireDateChange = changes.find((change) => change.field === 'hireDate')
    expect(hireDateChange).toEqual({ field: 'hireDate', before: null, after: '2024-01-01' })
  })

  test('★ 離職留下兩筆稽核（任職異動 ＋ 帳號停用），並同步停用公司帳號但不刪除', async () => {
    const { companyId, operatorCompanyUserId, employeeId, employeeCompanyUserId } = await registerFixture()
    const context: EmploymentsMainContext = { db: database, clock, companyId, operatorCompanyUserId }

    const created = await createEmployment(context, {
      employeeId,
      employmentTypeCode: 1,
      employmentNatureCode: null,
      hireDate: '2024-01-01',
    })
    if (!created.ok) throw new Error('建立任職失敗，測試前置條件不成立')

    const left = await leaveEmployment(context, {
      id: created.value.id,
      leaveDate: '2024-12-31',
      lastWorkingDate: '2024-12-30',
      leaveReasonCode: 1,
    })
    if (!left.ok) throw new Error('辦理離職失敗，測試前置條件不成立')

    expect(left.value.status).toBe('LEFT')
    expect(left.value.leaveDate).toBe('2024-12-31')
    expect(left.value.lastWorkingDate).toBe('2024-12-30')

    // 任職這個主體會有兩筆稽核（create、leave 各一筆，同一個 employment id）：本測試只看
    // `leave` 這一筆——`create` 的內容已經由前一個測試驗證過。
    const employmentLogs = await readAuditLogs(companyId, 'employee_employments', created.value.id)
    expect(employmentLogs.length).toBe(2)
    const employmentLog = employmentLogs.find((log) => log.action === 'employments.main.leave')
    if (employmentLog === undefined) throw new Error('離職的任職稽核紀錄不存在')
    expect(employmentLog.effectiveDate).toBe('2024-12-31')
    const employmentChanges = parseChanges(employmentLog.changes)
    expect(employmentChanges.find((change) => change.field === 'leaveDate')).toEqual({
      field: 'leaveDate',
      before: null,
      after: '2024-12-31',
    })
    expect(employmentChanges.find((change) => change.field === 'lastWorkingDate')).toEqual({
      field: 'lastWorkingDate',
      before: null,
      after: '2024-12-30',
    })
    expect(employmentChanges.find((change) => change.field === 'leaveReasonCode')).toEqual({
      field: 'leaveReasonCode',
      before: null,
      after: 1,
    })
    expect(employmentChanges.find((change) => change.field === 'status')).toEqual({
      field: 'status',
      before: 'ACTIVE',
      after: 'LEFT',
    })

    // 第二筆：帳號停用（同一筆離職動作、同一個交易，主體是 company_users）。
    const companyUserLogs = await readAuditLogs(companyId, 'company_users', employeeCompanyUserId)
    expect(companyUserLogs.length).toBe(1)
    const [companyUserLog] = companyUserLogs
    if (companyUserLog === undefined) throw new Error('帳號停用稽核紀錄不存在')
    expect(companyUserLog.action).toBe('employments.main.leave')
    const companyUserChanges = parseChanges(companyUserLog.changes)
    expect(companyUserChanges.find((change) => change.field === 'status')).toEqual({
      field: 'status',
      before: 'ACTIVE',
      after: 'INACTIVE',
    })

    // 帳號本身：狀態變成 INACTIVE，但 users／company_users 都還在（不刪除帳號與角色歷史，計畫 §7）。
    const [companyUserRow] = await database
      .select({ status: companyUsers.status, userId: companyUsers.userId })
      .from(companyUsers)
      .where(eq(companyUsers.id, employeeCompanyUserId))
    expect(companyUserRow?.status).toBe(CompanyUserStatus.Inactive)
    expect(companyUserRow?.userId).toBeTruthy()
  })
})
