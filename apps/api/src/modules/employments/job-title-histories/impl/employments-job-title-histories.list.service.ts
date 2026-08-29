/** 業務動作：查詢職稱歷史清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitleHistoriesContext } from '../domain/job-title-history-context.ts'
import type { JobTitleHistoryListPage, JobTitleHistoryListQuery } from '../domain/job-title-history-model.ts'
import { listJobTitleHistoryPage } from '../employments-job-title-histories.repository.ts'

export const listJobTitleHistories = async (
  context: JobTitleHistoriesContext,
  query: JobTitleHistoryListQuery,
): Promise<ServiceResult<JobTitleHistoryListPage>> =>
  succeed(await listJobTitleHistoryPage(context.db, context.companyId, query))
