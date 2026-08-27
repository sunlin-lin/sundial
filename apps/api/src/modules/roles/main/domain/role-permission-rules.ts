/**
 * 權限選取的錯誤組裝（零 IO 純函式）。
 *
 * 「這個權限存不存在、可不可以授予」由 `permissions/main` 的 `checkAssignable` 回答（跨大目錄
 * 一律走對方的 `index.ts`，§0.3）；本檔負責把它回傳的兩份 id 清單**對回使用者送來的陣列位置**，
 * 組成帶索引的錯誤。這個分工是對方刻意留的：錯誤要用哪個碼、`field` 要指到第幾筆，
 * 只有呼叫端知道——在對方那裡就把錯誤組好，等於逼所有呼叫端共用同一個 `field` 字串。
 *
 * 這裡是 §3.1.1「收集錯誤而不是拋例外」最容易被寫壞的地方：手上有一個陣列、一邊跑迴圈一邊檢查，
 * 最順手的寫法就是第一筆不對就 `return`。那樣寫之後，envelope 的 `errors` 陣列**永遠只裝得下
 * 一個元素**，使用者勾錯三個權限要送三次才知道總共錯了幾個，而前端為多筆錯誤寫的定位邏輯等於白寫。
 * 因此本檔的函式一律「跑完整個迴圈、回傳整包錯誤」，沒有提早結束的路徑。
 */
import type { AssignabilityCheck } from '../../../permissions/index.ts'
import type { DomainError } from '../../../../shared/service-result.ts'
import { permissionNotAssignable, permissionNotFound } from '../roles-main.errors.ts'

/**
 * 把「不存在」與「不可授予」兩份清單對回輸入陣列的位置，累積成錯誤。
 *
 * @param requestedIds 使用者送來的權限 ID，**依原始順序**——`errors[].data.field` 的索引必須
 *   對得上前端表單上的第幾個勾選框，去重或排序過的清單會讓索引指到別的地方。
 * @param check `permissions/main` 的判定結果（已去重，因此以集合比對而不是逐項尋找）。
 * @returns 全部錯誤（可能多筆）；空陣列代表通過。
 */
export const collectPermissionSelectionErrors = (
  requestedIds: readonly string[],
  check: AssignabilityCheck,
): readonly DomainError[] => {
  const missing = new Set(check.missingIds)
  const notAssignable = new Set(check.notAssignableIds)
  const errors: DomainError[] = []

  requestedIds.forEach((permissionId, index) => {
    if (missing.has(permissionId)) {
      errors.push(permissionNotFound(index))
      return
    }
    if (notAssignable.has(permissionId)) {
      errors.push(permissionNotAssignable(index))
    }
  })

  return errors
}

/**
 * 去除重複的權限 ID，保留第一次出現的順序。
 *
 * `role_permissions` 的主鍵是 `(company_id, role_id, permission_id)`，重複送同一個 ID 會撞唯一鍵
 * 而變成一個對使用者毫無意義的系統錯誤。前端的權限樹在半選狀態下重複送出同一個節點是常見的，
 * 因此在寫入前收斂——**但錯誤仍然逐筆對位**（見上），使用者送了什麼就標在第幾筆。
 */
export const dedupePermissionIds = (permissionIds: readonly string[]): readonly string[] => [...new Set(permissionIds)]
