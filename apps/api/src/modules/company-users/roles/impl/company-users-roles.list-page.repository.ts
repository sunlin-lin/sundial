/**
 * 資料存取動作：分頁查詢角色指派紀錄。
 *
 * 「取一頁」與「算總筆數」寫在同一個動作裡，不拆成兩個切片：它們必須用**同一組**
 * FROM／JOIN／WHERE，否則分頁列會與 `totalCount` 對不起來（使用者看到「共 20 筆」卻只有 18 列，
 * 而且沒有任何錯誤）。切片之間依 §0.4 不得互相 import，硬拆的結果只會是條件被複製兩份。
 *
 * 全部以顯式 `select` ＋ `join` 撰寫，不使用 Drizzle 的 relational query API（§4.6）：
 * 這段 SQL 的 `EXPLAIN` 要貼得進 PR，而巢狀 JSON 聚合得先把實際 SQL 印出來才知道它掃了哪些表。
 */
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { QueryRunner } from '../../../../db/client.ts'
import { companyUserRoles, companyUsers, roles, users } from '../../../../db/schema/index.ts'
import type { AssignmentSort } from '../domain/role-assignment-sort.ts'

export type AssignmentPageCriteria = {
  /** `null` 代表不篩選。service 層的型別用 `null` 而不是選填欄位，才不會與「使用者送了 undefined」混淆。 */
  readonly companyUserId: string | null
  readonly roleId: string | null
  /** `false` 時只回未撤銷的指派；`true` 時連撤銷歷程一起回（畫面上的「歷史紀錄」用）。 */
  readonly includeRevoked: boolean
  readonly perPage: number
  readonly currentPage: number
  readonly sort: AssignmentSort
}

export type AssignmentRow = {
  readonly id: string
  readonly companyUserId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly assignedAt: string
  readonly assignedByName: string
  readonly revokedAt: string | null
  readonly revokedByName: string | null
}

export type AssignmentPage = {
  readonly rows: readonly AssignmentRow[]
  readonly totalCount: number
}

// 同一張表在一個查詢裡出現兩次（指派者與撤銷者），必須各自取別名，否則欄位參照無從分辨。
const assignedByMember = alias(companyUsers, 'assigned_by_member')
const assignedByAccount = alias(users, 'assigned_by_account')
const revokedByMember = alias(companyUsers, 'revoked_by_member')
const revokedByAccount = alias(users, 'revoked_by_account')

/**
 * 排序欄位 → 實際欄位。
 *
 * 白名單本身在 `domain/role-assignment-sort.ts`，這裡只做對應：把使用者送來的字串直接接進
 * `ORDER BY` 等於開放 SQL injection 與全表掃描（§1.4）。
 */
const SORT_COLUMNS = {
  assignedAt: companyUserRoles.assignedAt,
  roleCode: roles.code,
  roleName: roles.name,
  revokedAt: companyUserRoles.revokedAt,
} as const

/**
 * `company_id` 條件放在第一段（§4.2）：別家公司的資料在查詢階段就等同於不存在，
 * 因此「以 B 公司身分查 A 公司成員」與「查一個不存在的成員」得到的都是空清單（§3.2）。
 */
const buildConditions = (companyId: string, criteria: AssignmentPageCriteria): SQL | undefined =>
  and(
    eq(companyUserRoles.companyId, companyId),
    criteria.companyUserId === null ? undefined : eq(companyUserRoles.companyUserId, criteria.companyUserId),
    criteria.roleId === null ? undefined : eq(companyUserRoles.roleId, criteria.roleId),
    criteria.includeRevoked ? undefined : eq(companyUserRoles.revokedSeq, 0),
  )

export const listAssignmentPage = async (
  runner: QueryRunner,
  companyId: string,
  criteria: AssignmentPageCriteria,
): Promise<AssignmentPage> => {
  const conditions = buildConditions(companyId, criteria)
  const sortColumn = SORT_COLUMNS[criteria.sort.field]

  const rows = await runner
    .select({
      id: companyUserRoles.id,
      companyUserId: companyUserRoles.companyUserId,
      roleId: companyUserRoles.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      assignedAt: companyUserRoles.assignedAt,
      // 目前沒有 `employees` 表，員工姓名取不到，只能退而顯示登入帳號名稱。
      // 這一點已寫進交付回報：`employees` 建立後，這裡要換成員工姓名，`AssignmentRow`
      // 也要補 `employeeNo`／`employeeName`。
      assignedByName: assignedByAccount.username,
      revokedAt: companyUserRoles.revokedAt,
      revokedByName: revokedByAccount.username,
    })
    .from(companyUserRoles)
    // 角色 join **刻意不加 `roles.deleted_at IS NULL`**（§4.3 的預設作法在這裡不適用）：
    // 本清單是稽核歷程，UI §刪除角色 明文要求「歷史操作紀錄仍須能顯示當時使用的角色」。
    // 加了條件之後，角色一被軟刪除，過去所有指派與撤銷紀錄會整批從畫面上消失。
    .innerJoin(roles, and(eq(roles.id, companyUserRoles.roleId), eq(roles.companyId, companyUserRoles.companyId)))
    .innerJoin(
      assignedByMember,
      and(
        eq(assignedByMember.id, companyUserRoles.assignedBy),
        eq(assignedByMember.companyId, companyUserRoles.companyId),
      ),
    )
    // `users` 是全域表，沒有 `company_id`（見 `db/schema/users.ts`），因此這一段沒有公司條件——
    // 它由上一段的 `company_users` 擋住了：走得到這裡的帳號一定是本公司成員的帳號。
    .innerJoin(assignedByAccount, eq(assignedByAccount.id, assignedByMember.userId))
    // 撤銷者可以是 NULL（指派仍有效），因此是 LEFT JOIN；用 INNER 會讓所有「尚未撤銷」的列消失。
    .leftJoin(
      revokedByMember,
      and(
        eq(revokedByMember.id, companyUserRoles.revokedBy),
        eq(revokedByMember.companyId, companyUserRoles.companyId),
      ),
    )
    .leftJoin(revokedByAccount, eq(revokedByAccount.id, revokedByMember.userId))
    .where(conditions)
    // 第二個排序鍵讓分頁穩定：主鍵同值時，資料庫沒有義務每次回相同順序，
    // 於是同一筆資料可能同時出現在第 1 頁與第 2 頁，或兩頁都沒有。
    .orderBy(criteria.sort.order === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(companyUserRoles.id))
    .limit(criteria.perPage)
    .offset((criteria.currentPage - 1) * criteria.perPage)

  // 總筆數用完全相同的 FROM／JOIN／WHERE。JOIN 看起來對 COUNT 沒有必要，但只要其中一個
  // INNER JOIN 有可能篩掉列（例如指派者不在本公司），少了它總筆數就會比實際列數多。
  const totals = await runner
    .select({ value: count() })
    .from(companyUserRoles)
    .innerJoin(roles, and(eq(roles.id, companyUserRoles.roleId), eq(roles.companyId, companyUserRoles.companyId)))
    .innerJoin(
      assignedByMember,
      and(
        eq(assignedByMember.id, companyUserRoles.assignedBy),
        eq(assignedByMember.companyId, companyUserRoles.companyId),
      ),
    )
    .innerJoin(assignedByAccount, eq(assignedByAccount.id, assignedByMember.userId))
    .where(conditions)

  return {
    rows: rows.map((row) => ({
      id: row.id,
      companyUserId: row.companyUserId,
      roleId: row.roleId,
      roleCode: row.roleCode,
      roleName: row.roleName,
      assignedAt: row.assignedAt,
      assignedByName: row.assignedByName,
      revokedAt: row.revokedAt,
      revokedByName: row.revokedByName ?? null,
    })),
    totalCount: totals[0]?.value ?? 0,
  }
}
