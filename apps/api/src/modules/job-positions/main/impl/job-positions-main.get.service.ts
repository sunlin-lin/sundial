/** 業務動作：查詢單一職務。理由與 `job-titles-main.get.service.ts` 同構。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionsMainContext } from '../domain/job-position-context.ts'
import type { JobPositionDetail, JobPositionTargetInput } from '../domain/job-position-model.ts'
import { findJobPositionDetail } from '../job-positions-main.repository.ts'

export const getJobPosition = async (
  context: JobPositionsMainContext,
  input: JobPositionTargetInput,
): Promise<ServiceResult<JobPositionDetail | null>> =>
  succeed(await findJobPositionDetail(context.db, context.companyId, input.id))
