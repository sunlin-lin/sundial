/**
 * 業務動作：分頁查詢角色指派紀錄。
 *
 * 這一層看起來只是轉手，但它是 §0.3 要求的那道牆：repository 不得被本次目錄以外的檔案 import，
 * 因為它只負責把資料撈出來、**不含本次目錄的業務規則**（有效指派的定義、公司範圍、
 * 已撤銷紀錄要不要含）。繞過它直接讀表的呼叫端，會在規則改變的那天靜靜地開始拿到不同的答案。
 */
import { listAssignmentPage } from '../company-users-roles.repository.ts'
import type {
  RoleAssignmentPage,
  RoleAssignmentQuery,
  RoleAssignmentQueryContext,
} from '../domain/role-assignment-model.ts'

export const listRoleAssignments = async (
  context: RoleAssignmentQueryContext,
  query: RoleAssignmentQuery,
): Promise<RoleAssignmentPage> => {
  const page = await listAssignmentPage(context.database, context.companyId, {
    companyUserId: query.companyUserId,
    roleId: query.roleId,
    includeRevoked: query.includeRevoked,
    perPage: query.perPage,
    currentPage: query.currentPage,
    sort: query.sort,
  })

  // `currentPage` 超出範圍時這裡自然是空陣列，而 `totalCount` 仍然正確——
  // §1.4 要求這種情況回空清單與正確的分頁資訊，不得回 404（404 代表端點不存在）。
  return {
    items: page.rows.map((row) => ({
      id: row.id,
      companyUserId: row.companyUserId,
      roleId: row.roleId,
      roleCode: row.roleCode,
      roleName: row.roleName,
      assignedAt: row.assignedAt,
      assignedByName: row.assignedByName,
      revokedAt: row.revokedAt,
      revokedByName: row.revokedByName,
    })),
    totalCount: page.totalCount,
  }
}
