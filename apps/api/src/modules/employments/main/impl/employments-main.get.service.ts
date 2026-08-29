/**
 * 業務動作：查詢單一任職。查無資料回 `null`，別家公司的任職也回 `null`（§1.3、§3.2、§4.2）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'
import type { EmploymentDetail, EmploymentTargetInput } from '../domain/employment-model.ts'
import { findEmploymentDetail } from '../employments-main.repository.ts'

export const getEmployment = async (
  context: EmploymentsMainContext,
  input: EmploymentTargetInput,
): Promise<ServiceResult<EmploymentDetail | null>> =>
  succeed(await findEmploymentDetail(context.db, context.companyId, input.id))
