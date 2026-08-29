/** 部門歷史的業務入口（§0.4）。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { DepartmentHistoriesContext } from './domain/department-history-context.ts'
import type {
  CreateDepartmentHistoryInput,
  DepartmentHistoryDetail,
  DepartmentHistoryListPage,
  DepartmentHistoryListQuery,
} from './domain/department-history-model.ts'
import { createDepartmentHistoryInTransaction as createDepartmentHistoryInTransactionImpl } from './impl/employments-department-histories.create.service.ts'
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
 *
 * 自己開交易，給併發測試與（將來）沒有外層交易的呼叫者用；差別見
 * `employees-main.service.ts` 的 `createEmployee` 說明。
 */
export const createDepartmentHistory = (
  context: DepartmentHistoriesContext,
  input: CreateDepartmentHistoryInput,
): Promise<ServiceResult<DepartmentHistoryDetail>> =>
  context.db.transaction((tx) => createDepartmentHistoryInTransactionImpl(tx, context, input))

/** 收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const createDepartmentHistoryInTransaction = (
  tx: TransactionRunner,
  context: DepartmentHistoriesContext,
  input: CreateDepartmentHistoryInput,
): Promise<ServiceResult<DepartmentHistoryDetail>> => createDepartmentHistoryInTransactionImpl(tx, context, input)

export const listDepartmentHistories = (
  context: DepartmentHistoriesContext,
  query: DepartmentHistoryListQuery,
): Promise<ServiceResult<DepartmentHistoryListPage>> => listDepartmentHistoriesImpl(context, query)
