/**
 * 唯一鍵違反的判讀（零 IO 純函式）。理由與 `employees/main/domain/employee-duplicate.ts` 同構。
 *
 * **一定要比對索引名稱，不能只看 `errno`**：`employee_dependents` 上只有這一個公司內唯一鍵，
 * 但仍然沿用「比對名稱」的慣例——理由與 `employees` 檔頭同構：日後若加了第二個唯一鍵，
 * 只看 `errno` 會把兩種撞鍵誤判成同一種，而使用者怎麼改都不會成功。
 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

export const DEPENDENT_IDENTITY_UNIQUE_INDEX = 'uq_employee_dependents_company_employee_identity'

export type DependentInsertOutcome = 'inserted' | 'duplicate-identity-number'

export const classifyDependentDuplicate = (error: unknown): 'duplicate-identity-number' | null =>
  isUniqueViolation(error, DEPENDENT_IDENTITY_UNIQUE_INDEX) ? 'duplicate-identity-number' : null
