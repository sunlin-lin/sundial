/** 部門歷史的業務入口（§0.4）。 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { DepartmentHistoriesContext } from './domain/department-history-context.ts'
import type {
  CreateDepartmentHistoryInput,
  DepartmentHistoryDetail,
  DepartmentHistoryListPage,
  DepartmentHistoryListQuery,
} from './domain/department-history-model.ts'
import { createDepartmentHistory as createDepartmentHistoryImpl } from './impl/employments-department-histories.create.service.ts'
import { listDepartmentHistories as listDepartmentHistoriesImpl } from './impl/employments-department-histories.list.service.ts'

export type { DepartmentHistoriesContext }
export type {
  CreateDepartmentHistoryInput,
  DepartmentHistoryDetail,
  DepartmentHistoryListPage,
  DepartmentHistoryListQuery,
} from './domain/department-history-model.ts'

/**
 * **沒有對外端點**（見 `employments-department-histories.routes.ts` 沒有 `create`）；
 * 這裡仍然是入口的原因見 `impl/employments-department-histories.create.service.ts` 檔頭。
 */
export const createDepartmentHistory = (
  context: DepartmentHistoriesContext,
  input: CreateDepartmentHistoryInput,
): Promise<ServiceResult<DepartmentHistoryDetail>> => createDepartmentHistoryImpl(context, input)

export const listDepartmentHistories = (
  context: DepartmentHistoriesContext,
  query: DepartmentHistoryListQuery,
): Promise<ServiceResult<DepartmentHistoryListPage>> => listDepartmentHistoriesImpl(context, query)
