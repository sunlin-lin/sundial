/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `departments/main/domain/department-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

/**
 * `job_titles` 的公司內代碼唯一鍵。**只比對這一個**：本模組的寫入動作（新增／修改）一律替
 * 呼叫端已驗證的公司寫入非 NULL 的 `company_id`（見 `db/schema/job-titles.ts` 檔頭），
 * 不會撞到系統預設列（`company_id IS NULL`）之間的唯一鍵分組。
 */
const JOB_TITLE_CODE_UNIQUE_INDEX = 'uq_job_titles_company_code'

export type JobTitleInsertOutcome = 'inserted' | 'duplicate-code'

export const isDuplicateJobTitleCode = (error: unknown): boolean =>
  isUniqueViolation(error, JOB_TITLE_CODE_UNIQUE_INDEX)
