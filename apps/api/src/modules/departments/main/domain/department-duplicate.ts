/**
 * 唯一鍵違反的判讀（零 IO 純函式）。
 *
 * §4.3：唯一性檢查**禁止用「先 SELECT 再 INSERT」**取代資料庫唯一鍵——兩個併發請求會同時
 * 查到「沒有」，然後都寫進去。正確作法是直接寫入並攔截唯一鍵違反。本檔負責把驅動丟出來的
 * 那個例外翻譯成「撞到哪一個唯一鍵」（比照 `shifts/main/domain/shift-duplicate.ts`）。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/**
 * `departments` 的公司內代碼唯一鍵（migration 與 `db/schema/departments.ts` 逐字相同的名稱）。
 *
 * 表上還有 `uq_departments_company_id`，撞到它代表產生的 UUID 與既有列相同——那是不該發生的事，
 * 必須以系統錯誤爆出來讓人知道，而不是對使用者說「代碼重複」然後讓他換一個代碼再試一次
 * （他怎麼換都不會成功）。因此本函式只比對代碼唯一鍵，找不到就回 `false`，由呼叫端原樣重拋（§3.1.2）。
 */
const DEPARTMENT_CODE_UNIQUE_INDEX = 'uq_departments_company_code'

export type DepartmentInsertOutcome = 'inserted' | 'duplicate-code'

export const isDuplicateDepartmentCode = (error: unknown): boolean =>
  isUniqueViolation(error, DEPARTMENT_CODE_UNIQUE_INDEX)
