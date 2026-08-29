/**
 * 業務動作：查詢單一職稱。查無資料回 `null`（§1.3）。**含系統預設職稱**（`findJobTitleDetail`
 * 的查詢範圍，見該檔頭），公司應該看得到自己能選用的系統預設職稱長什麼樣子；不能看到別家公司
 * 自訂的職稱——公司範圍條件仍然存在，只是額外放行 `company_id IS NULL` 那一組。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitlesMainContext } from '../domain/job-title-context.ts'
import type { JobTitleDetail, JobTitleTargetInput } from '../domain/job-title-model.ts'
import { findJobTitleDetail } from '../job-titles-main.repository.ts'

export const getJobTitle = async (
  context: JobTitlesMainContext,
  input: JobTitleTargetInput,
): Promise<ServiceResult<JobTitleDetail | null>> =>
  succeed(await findJobTitleDetail(context.db, context.companyId, input.id))
