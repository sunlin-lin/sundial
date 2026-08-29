/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `department-histories/domain/department-history-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const JOB_TITLE_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX = 'uq_employee_job_title_histories_employment_from'

export type JobTitleHistoryInsertOutcome = 'inserted' | 'duplicate-effective-from'

export const isDuplicateJobTitleHistoryEffectiveFrom = (error: unknown): boolean =>
  isUniqueViolation(error, JOB_TITLE_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX)
