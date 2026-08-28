/**
 * 資料存取：單一角色的完整內容（基本資料 ＋ 已授予的權限 ＋ 目前的指派人數）。
 *
 * 三個查詢分開發，不是 N+1：N+1 指的是「一頁 20 筆各查一次」（§4.5），這裡是**單一目標**的
 * 三種不同資料，其中兩種是聚合與一對多，本來就無法在一句裡同時取回而不重複列。
 */
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUserRoles, permissions, rolePermissions, roles } from '../../../../db/schema/index.ts'
import type { RoleDetail } from '../domain/role-model.ts'

/**
 * 依 id 取角色。
 *
 * @returns 查無資料回 `null`。**別家公司的角色也回 `null`**，而且走的是同一行程式碼
 *   ——公司條件由 `TenantDatabase` 寫進 `WHERE`（§4.2），因此「不存在」與「屬於其他公司」
 *   想寫出不一致的回應都寫不出來（§3.2）。
 */
export const findRoleDetail = async (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
): Promise<RoleDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [role] = await tenant.select(
    {
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      status: roles.status,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    },
    roles,
    eq(roles.id, roleId),
    // §4.3：軟刪除的角色等同不存在，否則刪掉的角色還能被讀出來繼續編輯。
    isNull(roles.deletedAt),
  )

  if (role === undefined) return null

  // 顯式 join，不用 relational query API（§4.6）。join 條件寫在查詢裡，改錯當場就是結果不對；
  // 關聯宣告則是 schema 之外的第二份真相，漂移了不會有任何地方變紅。
  // 一併排除已刪除的權限：回一個前端權限樹上不存在的 id，畫面只會靜靜地少勾一格。
  const grantedPermissions = await tenant
    .selectFrom({ permissionId: rolePermissions.permissionId }, rolePermissions)
    .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), isNull(permissions.deletedAt)))
    // join 查詢也走封裝：`selectFrom()` 只做到 `FROM`（drizzle 要求 `JOIN` 接在 `FROM` 與 `WHERE`
    // 之間，封裝不能先把 `WHERE` 補上），公司條件則由 `scope()` 產生。
    // 重點是**連 runner 都不再外露**——公司 ID 只存在於封裝內部，這裡寫不出別家公司。
    .where(tenant.scope(rolePermissions, eq(rolePermissions.roleId, roleId)))
    // 依權限樹的顯示順序回傳：順序不穩定時，前端每次打開同一個角色看到的勾選順序都不一樣。
    .orderBy(asc(permissions.sortOrder), asc(permissions.code))

  // `revoked_seq = 0` 才是有效指派（撤銷時寫入非零值）。用它而不是 `revoked_at IS NULL`，
  // 是因為索引 `ix_company_user_roles_company_role` 的第三段就是它。
  const [assigned] = await tenant.select(
    { total: count() },
    companyUserRoles,
    eq(companyUserRoles.roleId, roleId),
    eq(companyUserRoles.revokedSeq, 0),
  )

  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    status: role.status,
    isSystem: role.isSystem,
    permissionIds: grantedPermissions.map((row) => row.permissionId),
    assignedUserCount: assigned?.total ?? 0,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}
