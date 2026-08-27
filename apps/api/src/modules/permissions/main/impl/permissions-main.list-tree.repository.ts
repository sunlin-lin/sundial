/**
 * 資料存取動作：取出組成權限樹所需的全部有效權限列。
 *
 * **本查詢刻意不帶 `company_id` 條件，這不是漏掉。** `permissions` 是全域表（見
 * `db/schema/permissions.ts`）：權限碼是端點路徑的機械轉換結果（§5.2.2），由程式碼決定
 * 而不是由客戶決定，每家公司一份副本會讓同一支端點在不同公司有不同的碼，推導規則就此失效。
 * 公司自訂的部分落在 `roles` 與 `role_permissions`，那兩張表才帶公司範圍。
 * 因此 §4.2「每一次查詢都必須帶 `company_id`」在本表上沒有適用對象——寫進來反而會編譯失敗
 * （`TenantDatabase` 只接受 `CompanyScopedTable`，`permissions` 不在其中）。
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { permissions, PermissionStatus } from '../../../../db/schema/index.ts'
import type { PermissionRow } from '../domain/permission-tree.ts'

/**
 * 取出所有可顯示的權限節點。
 *
 * 過濾條件有兩個，理由不同：
 * - `deleted_at IS NULL`（§4.3）：已刪除的權限若重新出現在角色設定頁，等於刪除從未生效。
 * - `status = ACTIVE`：停用的權限不該再被授予；讓它出現在勾選樹上，使用者會勾一個永遠不生效的項目。
 *
 * 排序在 SQL 這邊只是讓輸出穩定，真正的同層排序由 `buildPermissionTree` 負責
 * ——樹的順序是「同一個父節點底下」的順序，SQL 的全域排序表達不了它。
 */
export const listPermissionTreeRows = async (runner: QueryRunner): Promise<readonly PermissionRow[]> => {
  const rows = await runner
    .select({
      id: permissions.id,
      parentId: permissions.parentId,
      code: permissions.code,
      name: permissions.name,
      description: permissions.description,
      isAssignable: permissions.isAssignable,
      sortOrder: permissions.sortOrder,
    })
    .from(permissions)
    .where(and(isNull(permissions.deletedAt), eq(permissions.status, PermissionStatus.Active)))
    .orderBy(asc(permissions.sortOrder), asc(permissions.code))

  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    code: row.code,
    name: row.name,
    description: row.description,
    isAssignable: row.isAssignable,
    sortOrder: row.sortOrder,
  }))
}
