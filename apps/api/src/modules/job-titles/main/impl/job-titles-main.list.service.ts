/** 業務動作：查詢職稱清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitlesMainContext } from '../domain/job-title-context.ts'
import type { JobTitleListPage, JobTitleListQuery } from '../domain/job-title-model.ts'
import { listJobTitlePage } from '../job-titles-main.repository.ts'

export const listJobTitles = async (
  context: JobTitlesMainContext,
  query: JobTitleListQuery,
): Promise<ServiceResult<JobTitleListPage>> => succeed(await listJobTitlePage(context.db, context.companyId, query))
