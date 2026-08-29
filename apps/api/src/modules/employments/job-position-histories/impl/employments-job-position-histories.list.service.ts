/** 業務動作：查詢職務歷史清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionHistoriesContext } from '../domain/job-position-history-context.ts'
import type { JobPositionHistoryListPage, JobPositionHistoryListQuery } from '../domain/job-position-history-model.ts'
import { listJobPositionHistoryPage } from '../employments-job-position-histories.repository.ts'

export const listJobPositionHistories = async (
  context: JobPositionHistoriesContext,
  query: JobPositionHistoryListQuery,
): Promise<ServiceResult<JobPositionHistoryListPage>> =>
  succeed(await listJobPositionHistoryPage(context.db, context.companyId, query))
