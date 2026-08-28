/**
 * `company-users/roles` 的稽核整合測試（稽核計畫 §7 Stage 2 三筆欠帳之一，§6.2 要求的整合測試）。
 *
 * **直接呼叫模組入口**（`assignRoles`／`revokeRoles`），不透過 HTTP：這兩支動作要驗的是
 * 「稽核紀錄的內容與筆數」，那在 service 層就回答得完整；HTTP 邊界層（envelope、狀態碼映射）
 * 已經不是稽核這輪要驗的東西。
 *
 * **不得 mock 掉 `recordAudit`**（§7.3）：這幾條測試的全部價值就在於驗真的有寫進去。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { AuditActorType, auditLogs, companies, companyUsers, roles, users } from '../../../../db/schema/index.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { assignRoles, revokeRoles } from '../company-users-roles.service.ts'
import type { RoleAssignmentContext } from '../domain/role-assignment-model.ts'

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
 * 建立一家公司、一位操作者（同時當作被指派角色的成員）與兩個可用角色。
 *
 * §7.3 的例外：`companies`／`users`／`company_users`／`roles` 目前沒有從零開始的正式流程可以
 * 呼叫（`roles/main/create` 要求呼叫者已經登入且已經有權限碼，那正是本測試要建立的東西），
 * 只能直接寫入，理由已註明。
 */
const registerCompanyWithRoles = async (): Promise<{
  companyId: string
  companyUserId: string
  roleIdA: string
  roleIdB: string
}> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const roleIdA = crypto.randomUUID()
  const roleIdB = crypto.randomUUID()
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
    username: `roles-audit-${userId}`,
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
  await database.insert(roles).values([
    {
      id: roleIdA,
      companyId,
      code: 'ROLE-A',
      name: '角色 A',
      description: null,
      isSystem: false,
      status: 'ACTIVE',
      deletedAt: null,
      deletedSeq: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: roleIdB,
      companyId,
      code: 'ROLE-B',
      name: '角色 B',
      description: null,
      isSystem: false,
      status: 'ACTIVE',
      deletedAt: null,
      deletedSeq: 0,
      createdAt: now,
      updatedAt: now,
    },
  ])

  return { companyId, companyUserId, roleIdA, roleIdB }
}

/** 顯式列出欄位而不是 `select()` 全撈（§2）。 */
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

const parseChanges = (raw: unknown): readonly { field: string; before: unknown; after: unknown }[] =>
  (typeof raw === 'string' ? JSON.parse(raw) : raw) as readonly { field: string; before: unknown; after: unknown }[]

describe('company-users/roles 稽核整合（稽核計畫 §7 Stage 2）', () => {
  test('★ 一次指派多個角色：仍然只有一筆稽核，changes 帶前後完整的角色集合', async () => {
    const { companyId, companyUserId, roleIdA, roleIdB } = await registerCompanyWithRoles()
    const context: RoleAssignmentContext = {
      database,
      clock,
      companyId,
      operatorCompanyUserId: companyUserId,
    }

    const result = await assignRoles(context, { companyUserId, roleIds: [roleIdA, roleIdB] })
    expect(result.ok).toBe(true)

    // 主體是成員，不是每個角色——一次指派兩個角色只留一筆稽核，不是兩筆。
    const rows = await readAuditLogs(companyUserId)
    expect(rows).toHaveLength(1)

    const row = rows[0]
    expect(row?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(row?.actorCompanyUserId).toBe(companyUserId)
    expect(row?.action).toBe('company-users.roles.create')
    expect(row?.subjectTable).toBe('company_users')
    expect(row?.subjectId).toBe(companyUserId)

    const changes = parseChanges(row?.changes)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.field).toBe('roleIds')
    expect(changes[0]?.before).toBeNull()
    expect(JSON.parse(changes[0]?.after as string)).toEqual([roleIdA, roleIdB].sort())
  })

  test('撤銷角色：恰好新增一筆稽核，changes 的 roleIds 從兩個變成一個', async () => {
    const { companyId, companyUserId, roleIdA, roleIdB } = await registerCompanyWithRoles()
    const context: RoleAssignmentContext = {
      database,
      clock,
      companyId,
      operatorCompanyUserId: companyUserId,
    }

    await assignRoles(context, { companyUserId, roleIds: [roleIdA, roleIdB] })
    const beforeCount = (await readAuditLogs(companyUserId)).length

    const result = await revokeRoles(context, { companyUserId, roleIds: [roleIdA] })
    expect(result.ok).toBe(true)

    const rows = await readAuditLogs(companyUserId)
    expect(rows).toHaveLength(beforeCount + 1)

    const revokeRow = rows.find((row) => row.action === 'company-users.roles.revoke')
    expect(revokeRow?.actorTypeCode).toBe(AuditActorType.CompanyUser)
    expect(revokeRow?.actorCompanyUserId).toBe(companyUserId)
    expect(revokeRow?.subjectTable).toBe('company_users')
    expect(revokeRow?.subjectId).toBe(companyUserId)

    const changes = parseChanges(revokeRow?.changes)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.field).toBe('roleIds')
    expect(JSON.parse(changes[0]?.before as string)).toEqual([roleIdA, roleIdB].sort())
    expect(JSON.parse(changes[0]?.after as string)).toEqual([roleIdB])
  })
})
