/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `job-titles/main/domain/job-title-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const JOB_POSITION_CODE_UNIQUE_INDEX = 'uq_job_positions_company_code'

export type JobPositionInsertOutcome = 'inserted' | 'duplicate-code'

export const isDuplicateJobPositionCode = (error: unknown): boolean =>
  isUniqueViolation(error, JOB_POSITION_CODE_UNIQUE_INDEX)
