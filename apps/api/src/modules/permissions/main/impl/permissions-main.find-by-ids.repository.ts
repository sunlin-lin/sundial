/**
 * 資料存取動作：依 id 批次取出權限的可授權旗標與狀態。
 *
 * 與 `list-tree` 分成兩個切片（§0.4：repository 的動作 ＝ 資料存取動作）：兩者的查詢條件、
 * 回傳欄位與呼叫時機都不同，硬用同一支會變成「傳參數決定要不要過濾」的萬用查詢，
 * 而那種查詢的每一個呼叫點都要重看一次參數才知道它撈了什麼。
 *
 * **本查詢同樣刻意不帶 `company_id`**，理由見 `permissions-main.list-tree.repository.ts` 檔頭：
 * `permissions` 是全域表。
 */
import { and, inArray, isNull } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { permissions, type PermissionStatusValue } from '../../../../db/schema/index.ts'

/** 授權判定所需的最小欄位。 */
export type PermissionAssignability = {
  readonly id: string
  readonly isAssignable: boolean
  readonly status: PermissionStatusValue
}

/**
 * @param permissionIds 要查的權限 id，允許重複（呼叫端可能直接把使用者勾選的清單丟進來）。
 * @returns 以 id 為鍵的對照表；**只排除軟刪除，不排除停用**。
 *
 * 停用的權限刻意留在結果裡，讓呼叫端能把它歸類為「存在但不可授權」而不是「不存在」
 * ——兩者對使用者的意義完全不同：一個是「這個權限被關掉了」，一個是「你送了一個不存在的 id」，
 * 前者要去問管理員，後者是前端送錯。查詢就把它們合併掉的話，呼叫端再也分不出來。
 */
export const findPermissionsByIds = async (
  runner: QueryRunner,
  permissionIds: readonly string[],
): Promise<ReadonlyMap<string, PermissionAssignability>> => {
  // 空清單直接短路：`IN ()` 不是合法 SQL，而「沒有要查的東西」本來就不需要往資料庫走一趟。
  if (permissionIds.length === 0) return new Map()

  const rows = await runner
    .select({ id: permissions.id, isAssignable: permissions.isAssignable, status: permissions.status })
    .from(permissions)
    .where(and(inArray(permissions.id, [...new Set(permissionIds)]), isNull(permissions.deletedAt)))

  return new Map(
    rows.map((row): [string, PermissionAssignability] => [
      row.id,
      { id: row.id, isAssignable: row.isAssignable, status: row.status },
    ]),
  )
}
