/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `employments/main/domain/employment-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const DEPARTMENT_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX = 'uq_employee_department_histories_employment_from'

export type DepartmentHistoryInsertOutcome = 'inserted' | 'duplicate-effective-from'

export const isDuplicateDepartmentHistoryEffectiveFrom = (error: unknown): boolean =>
  isUniqueViolation(error, DEPARTMENT_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX)
