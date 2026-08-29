/** 職稱歷史的業務入口（§0.4）。形狀比照 `department-histories/employments-department-histories.service.ts`。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { JobTitleHistoriesContext } from './domain/job-title-history-context.ts'
import type {
  CreateJobTitleHistoryInput,
  JobTitleHistoryDetail,
  JobTitleHistoryListPage,
  JobTitleHistoryListQuery,
} from './domain/job-title-history-model.ts'
import { createJobTitleHistoryInTransaction as createJobTitleHistoryInTransactionImpl } from './impl/employments-job-title-histories.create.service.ts'
import { listJobTitleHistories as listJobTitleHistoriesImpl } from './impl/employments-job-title-histories.list.service.ts'

export type { JobTitleHistoriesContext }
export type {
  CreateJobTitleHistoryInput,
  JobTitleHistoryDetail,
  JobTitleHistoryListPage,
  JobTitleHistoryListQuery,
} from './domain/job-title-history-model.ts'

/** 自己開交易，給單一端點與併發測試用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createJobTitleHistory = (
  context: JobTitleHistoriesContext,
  input: CreateJobTitleHistoryInput,
): Promise<ServiceResult<JobTitleHistoryDetail>> =>
  context.db.transaction((tx) => createJobTitleHistoryInTransactionImpl(tx, context, input))

/** 收外部交易 handle，給 `employees/onboarding` 編排點用（計畫 §4.1）。 */
export const createJobTitleHistoryInTransaction = (
  tx: TransactionRunner,
  context: JobTitleHistoriesContext,
  input: CreateJobTitleHistoryInput,
): Promise<ServiceResult<JobTitleHistoryDetail>> => createJobTitleHistoryInTransactionImpl(tx, context, input)

export const listJobTitleHistories = (
  context: JobTitleHistoriesContext,
  query: JobTitleHistoryListQuery,
): Promise<ServiceResult<JobTitleHistoryListPage>> => listJobTitleHistoriesImpl(context, query)
