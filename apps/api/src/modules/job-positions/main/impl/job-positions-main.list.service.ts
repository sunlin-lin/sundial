/** 業務動作：查詢職務清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionsMainContext } from '../domain/job-position-context.ts'
import type { JobPositionListPage, JobPositionListQuery } from '../domain/job-position-model.ts'
import { listJobPositionPage } from '../job-positions-main.repository.ts'

export const listJobPositions = async (
  context: JobPositionsMainContext,
  query: JobPositionListQuery,
): Promise<ServiceResult<JobPositionListPage>> =>
  succeed(await listJobPositionPage(context.db, context.companyId, query))
