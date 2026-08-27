/**
 * `permissions/main` 的錯誤字典（§0.4）。
 *
 * 本次目錄目前**一個業務錯誤碼都沒有**，這一節仍然要存在，而且清單要明確寫成空的（§1.8.3）：
 * 省略時「這支端點沒有業務錯誤」與「有人忘了宣告」在契約上長得一模一樣，前端只能一律
 * 當作「可能有沒寫出來的錯誤」而退回保守處理，這份清單的價值就沒了。
 *
 * 為什麼真的沒有錯誤碼：
 * - `tree` 是查詢類端點，「查無資料」不是錯誤而是一個正常且有效的答案（§3.1.3），回空陣列。
 * - `checkAssignable` 刻意不組錯誤——它回兩份 id 清單，由呼叫端（`roles/main`）用**自己**的
 *   錯誤碼與 `field` 位置組出 `errors[]`。那些碼屬於 `roles/main` 的錯誤字典，不屬於這裡：
 *   錯誤碼的「領域」是功能分類，不是目錄名（§1.3）。
 */
import type { ErrorCode } from '../../../shared/service-result.ts'

/** `POST /permissions/main/tree` 可能吐出的業務錯誤碼（§1.8.3）。刻意為空。 */
export const PERMISSIONS_MAIN_TREE_ERROR_CODES: readonly ErrorCode[] = []
