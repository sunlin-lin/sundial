/** 業務動作：查詢部門歷史清單。查詢類端點沒有業務錯誤（§3.1.3）。 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentHistoriesContext } from '../domain/department-history-context.ts'
import type { DepartmentHistoryListPage, DepartmentHistoryListQuery } from '../domain/department-history-model.ts'
import { listDepartmentHistoryPage } from '../employments-department-histories.repository.ts'

export const listDepartmentHistories = async (
  context: DepartmentHistoriesContext,
  query: DepartmentHistoryListQuery,
): Promise<ServiceResult<DepartmentHistoryListPage>> =>
  succeed(await listDepartmentHistoryPage(context.db, context.companyId, query))
