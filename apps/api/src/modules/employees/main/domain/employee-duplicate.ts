/**
 * 唯一鍵違反的判讀（零 IO 純函式）。
 *
 * §4.3：唯一性檢查**禁止用「先 SELECT 再 INSERT」**取代資料庫唯一鍵——兩個併發請求會同時
 * 查到「沒有」，然後都寫進去。正確作法是直接寫入並攔截唯一鍵違反。本檔負責把驅動丟出來的
 * 那個例外翻譯成「撞到哪一個唯一鍵」。
 *
 * **為什麼在 `domain/`：** insert 與 update 兩個切片都要用它，而切片之間不得互相 import（§0.4）；
 * 它不碰 IO（只讀一個已經拿在手上的例外物件），因此走 §0.4 指定的第二條路。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/**
 * `employees` 的兩個公司內唯一鍵。
 *
 * 名稱必須與 migration 及 `db/schema/employees.ts` **逐字相同**：唯一鍵違反時 MariaDB 報的是
 * 資料庫端的名字，對不上程式碼裡的任何字串就只能逐表比對，而比對錯的後果是把 A 的重複
 * 回報成 B 的重複——使用者照著訊息去改另一個欄位，怎麼改都不會成功。
 *
 * **`EMPLOYEE_IDENTITY_UNIQUE_INDEX` 指向明文欄位上的新鍵，不是舊的 `uq_employees_company_identity`**
 * （見 `db/schema/employees.ts` 檔頭「敏感欄位改回明文」）：新寫入的列一律走這條，舊的 blind
 * index 唯一鍵只對回填前的舊資料仍然有效，本模組的程式碼不再需要認得它。
 */
export const EMPLOYEE_CODE_UNIQUE_INDEX = 'uq_employees_company_code'
export const EMPLOYEE_IDENTITY_UNIQUE_INDEX = 'uq_employees_company_identity_plain'

/** 寫入結果。`not-affected` 只會出現在 update：條件式 UPDATE 沒有命中任何列（§4.4）。 */
export type EmployeeWriteOutcome = 'written' | 'not-affected' | 'duplicate-code' | 'duplicate-identity-number'

/** 只有重複相關的兩種結果。分出這個型別，是為了讓 insert 的回傳型別排除 `not-affected`。 */
export type EmployeeDuplicateOutcome = Extract<EmployeeWriteOutcome, 'duplicate-code' | 'duplicate-identity-number'>

/**
 * 這個例外是不是「撞到 `employees` 的某一個公司內唯一鍵」。
 *
 * **一定要比對索引名稱，不能只看 `errno`**：`employees` 上還有 `uq_employees_company_id`，
 * 撞到它代表產生的 UUID 與既有列相同——那是不該發生的事，必須以系統錯誤爆出來讓人知道，
 * 而不是對使用者說「編號重複」然後讓他換一個編號再試（他怎麼換都不會成功）。
 * 因此本函式對無法辨識的唯一鍵回 `null`，由呼叫端原樣重拋（§3.1.2）。
 *
 * **已知限制（誠實註明）：** 資料庫一次只會回報**一個**唯一鍵違反，因此當員工編號與身分證
 * 同時重複時，使用者只會先看到其中一筆，改完再送才會看到另一筆。這與 §3.1.1「錯誤要收集、
 * 一次回報多筆」有張力，但另一條路（先 SELECT 兩次再寫）被 §4.3 明文禁止，
 * 因為它在併發下必然失守。兩害相權，這裡選擇正確性——少回一筆錯誤只是多送一次表單，
 * 漏擋一筆重複則是資料庫裡從此有兩個同一個人。
 */
export const classifyEmployeeDuplicate = (error: unknown): EmployeeDuplicateOutcome | null => {
  if (isUniqueViolation(error, EMPLOYEE_CODE_UNIQUE_INDEX)) return 'duplicate-code'
  if (isUniqueViolation(error, EMPLOYEE_IDENTITY_UNIQUE_INDEX)) return 'duplicate-identity-number'
  return null
}
