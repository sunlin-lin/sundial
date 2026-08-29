/** 唯一鍵違反的判讀（零 IO 純函式）。理由與其餘歷史表的同名檔同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/**
 * ★ 比其餘歷史表多帶 `job_position_id`：`UNIQUE(company_id, employment_id, job_position_id,
 * effective_from)`，不是 `UNIQUE(employment_id, effective_from)`——理由見
 * `db/schema/employee-job-position-histories.ts` 檔頭。
 */
const JOB_POSITION_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX = 'uq_employee_job_position_histories_employment_position_from'

export type JobPositionHistoryInsertOutcome = 'inserted' | 'duplicate-effective-from'

export const isDuplicateJobPositionHistoryEffectiveFrom = (error: unknown): boolean =>
  isUniqueViolation(error, JOB_POSITION_HISTORY_EFFECTIVE_FROM_UNIQUE_INDEX)
