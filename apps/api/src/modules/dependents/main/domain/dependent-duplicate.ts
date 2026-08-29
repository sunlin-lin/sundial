/**
 * 唯一鍵違反的判讀（零 IO 純函式）。理由與 `employees/main/domain/employee-duplicate.ts` 同構。
 *
 * **一定要比對索引名稱，不能只看 `errno`**：`employee_dependents` 上有兩個公司內唯一鍵（新舊各
 * 一，見 `db/schema/employee-dependents.ts` 檔頭「敏感欄位改回明文」），但仍然沿用「比對名稱」
 * 的慣例——理由與 `employees` 檔頭同構：只看 `errno` 會把兩種撞鍵誤判成同一種，而使用者怎麼改
 * 都不會成功。
 *
 * **指向明文欄位上的新鍵**：新寫入的列一律走這條，舊的 blind index 唯一鍵只對回填前的舊資料
 * 仍然有效，本模組的程式碼不再需要認得它。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

export const DEPENDENT_IDENTITY_UNIQUE_INDEX = 'uq_employee_dependents_company_employee_identity_plain'

export type DependentInsertOutcome = 'inserted' | 'duplicate-identity-number'

export const classifyDependentDuplicate = (error: unknown): 'duplicate-identity-number' | null =>
  isUniqueViolation(error, DEPENDENT_IDENTITY_UNIQUE_INDEX) ? 'duplicate-identity-number' : null
