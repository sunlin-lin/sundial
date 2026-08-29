/** 職務歷史的業務入口（§0.4）。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { JobPositionHistoriesContext } from './domain/job-position-history-context.ts'
import type {
  CreateJobPositionHistoriesInput,
  JobPositionHistoryDetail,
  JobPositionHistoryListPage,
  JobPositionHistoryListQuery,
} from './domain/job-position-history-model.ts'
import { createJobPositionHistoriesInTransaction as createJobPositionHistoriesInTransactionImpl } from './impl/employments-job-position-histories.create.service.ts'
import { listJobPositionHistories as listJobPositionHistoriesImpl } from './impl/employments-job-position-histories.list.service.ts'

export type { JobPositionHistoriesContext }
export type {
  CreateJobPositionHistoriesInput,
  JobPositionHistoryDetail,
  JobPositionHistoryListPage,
  JobPositionHistoryListQuery,
} from './domain/job-position-history-model.ts'

/** 自己開交易，給單一端點與併發測試用。 */
export const createJobPositionHistories = (
  context: JobPositionHistoriesContext,
  input: CreateJobPositionHistoriesInput,
): Promise<ServiceResult<readonly JobPositionHistoryDetail[]>> =>
  context.db.transaction((tx) => createJobPositionHistoriesInTransactionImpl(tx, context, input))

/** 收外部交易 handle，給 `employees/onboarding` 編排點用（計畫 §4.1）。 */
export const createJobPositionHistoriesInTransaction = (
  tx: TransactionRunner,
  context: JobPositionHistoriesContext,
  input: CreateJobPositionHistoriesInput,
): Promise<ServiceResult<readonly JobPositionHistoryDetail[]>> =>
  createJobPositionHistoriesInTransactionImpl(tx, context, input)

export const listJobPositionHistories = (
  context: JobPositionHistoriesContext,
  query: JobPositionHistoryListQuery,
): Promise<ServiceResult<JobPositionHistoryListPage>> => listJobPositionHistoriesImpl(context, query)
