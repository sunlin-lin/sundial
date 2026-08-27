/**
 * 業務動作：檢查一組權限 id 是否存在且可授權。
 *
 * **這個動作沒有對應的端點，但它放在入口檔（§0.4）**：它的呼叫者是 `roles/main` 的
 * create 與 update ——「有沒有次目錄以外的呼叫者」才是入口與實作細節的界線，
 * 「有沒有前端在打」不是。塞進 `impl/` 會讓那兩支端點只能繞過入口直接 import 實作切片。
 *
 * **刻意回傳兩份清單而不是回傳錯誤集合**：錯誤要用哪個碼、`field` 要指到 `permissionIds.2`
 * 還是別的位置，只有呼叫端知道（它才知道使用者送進來的欄位叫什麼、在第幾筆）。
 * 在這裡就把錯誤組好，等於逼所有呼叫端共用同一個 `field` 字串，而那個字串一定有人是錯的。
 */
import { PermissionStatus } from '../../../../db/schema/index.ts'
import { findPermissionsByIds, type QueryRunner } from '../permissions-main.repository.ts'

export type AssignabilityCheck = {
  /** 查無此權限（不存在或已軟刪除）。 */
  readonly missingIds: readonly string[]
  /** 權限存在，但不可授予：分類節點（`is_assignable = false`）或已停用。 */
  readonly notAssignableIds: readonly string[]
}

/**
 * @param permissionIds 待檢查的權限 id，允許重複；回傳清單已去重並保留首次出現的順序，
 *   讓呼叫端能穩定地把它對回自己的輸入陣列。
 *
 * 「已停用」歸在 `notAssignableIds` 而不是 `missingIds`：這兩者對使用者的意義不同
 * （一個是「這個權限被關掉了」，要去問管理員；一個是「送了不存在的 id」，是前端的問題），
 * 合併之後呼叫端再也分不出來，只能給一句含糊的訊息。
 */
export const checkAssignable = async (
  runner: QueryRunner,
  permissionIds: readonly string[],
): Promise<AssignabilityCheck> => {
  const found = await findPermissionsByIds(runner, permissionIds)

  const missingIds: string[] = []
  const notAssignableIds: string[] = []
  const seen = new Set<string>()

  for (const permissionId of permissionIds) {
    if (seen.has(permissionId)) continue
    seen.add(permissionId)

    const permission = found.get(permissionId)
    if (permission === undefined) {
      missingIds.push(permissionId)
      continue
    }
    if (!permission.isAssignable || permission.status !== PermissionStatus.Active) {
      notAssignableIds.push(permissionId)
    }
  }

  return { missingIds, notAssignableIds }
}
