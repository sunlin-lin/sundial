/**
 * 業務動作：取得整棵權限樹。
 *
 * 這一層薄得幾乎只有兩行，但它不能省：repository 依 §0.3 不得被本次目錄以外的檔案 import，
 * 而「過濾規則（軟刪除、停用）＋ 組樹規則」合起來才是這個次目錄對外承諾的東西。
 * 讓 handler 直接打 repository 的話，下次多一條過濾規則就會只加在其中一個呼叫點上。
 */
import { buildPermissionTree, type PermissionNode } from '../domain/permission-tree.ts'
import { listPermissionTreeRows, type QueryRunner } from '../permissions-main.repository.ts'

/**
 * @returns 依 `sortOrder`、`code` 排序的根節點清單。查無資料回空陣列
 *   ——查詢類端點的「沒有資料」是一個正常且有效的答案，不是錯誤（§3.1.3）。
 *
 * **不回 `ServiceResult`**：本動作沒有任何業務規則可以拒絕它，包一層失敗分支只會讓每個呼叫端
 * 都要處理一個永遠不會發生的情況（§1.8.3 對應的錯誤碼清單因此是空的）。
 */
export const loadPermissionTree = async (runner: QueryRunner): Promise<readonly PermissionNode[]> =>
  buildPermissionTree(await listPermissionTreeRows(runner))
