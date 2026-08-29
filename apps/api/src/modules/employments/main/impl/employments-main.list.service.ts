/**
 * 業務動作：查詢任職清單。查詢類端點沒有業務錯誤（§3.1.3），理由與 `employees-main.list.
 * service.ts` 相同。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'
import type { EmploymentListPage, EmploymentListQuery } from '../domain/employment-model.ts'
import { listEmploymentPage } from '../employments-main.repository.ts'

export const listEmployments = async (
  context: EmploymentsMainContext,
  query: EmploymentListQuery,
): Promise<ServiceResult<EmploymentListPage>> => succeed(await listEmploymentPage(context.db, context.companyId, query))
