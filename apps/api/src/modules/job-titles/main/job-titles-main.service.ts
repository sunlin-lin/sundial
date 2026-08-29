/**
 * 職稱主檔的業務入口（§0.4）。形狀比照 `departments/main/departments-main.service.ts`。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { JobTitlesMainContext } from './domain/job-title-context.ts'
import type {
  CreateJobTitleInput,
  DeletedJobTitle,
  JobTitleDetail,
  JobTitleListPage,
  JobTitleListQuery,
  JobTitleTargetInput,
  UpdateJobTitleInput,
} from './domain/job-title-model.ts'
import { createJobTitleInTransaction as createJobTitleInTransactionImpl } from './impl/job-titles-main.create.service.ts'
import { deleteJobTitleInTransaction as deleteJobTitleInTransactionImpl } from './impl/job-titles-main.delete.service.ts'
import { getJobTitle as getJobTitleImpl } from './impl/job-titles-main.get.service.ts'
import { listJobTitles as listJobTitlesImpl } from './impl/job-titles-main.list.service.ts'
import { updateJobTitleInTransaction as updateJobTitleInTransactionImpl } from './impl/job-titles-main.update.service.ts'

export type { JobTitlesMainContext }
export type {
  CreateJobTitleInput,
  DeletedJobTitle,
  JobTitleDetail,
  JobTitleListPage,
  JobTitleListQuery,
  JobTitleTargetInput,
  UpdateJobTitleInput,
} from './domain/job-title-model.ts'

export const listJobTitles = (
  context: JobTitlesMainContext,
  query: JobTitleListQuery,
): Promise<ServiceResult<JobTitleListPage>> => listJobTitlesImpl(context, query)

export const getJobTitle = (
  context: JobTitlesMainContext,
  input: JobTitleTargetInput,
): Promise<ServiceResult<JobTitleDetail | null>> => getJobTitleImpl(context, input)

/** 新增職稱。自己開交易，給單一端點用。 */
export const createJobTitle = (
  context: JobTitlesMainContext,
  input: CreateJobTitleInput,
): Promise<ServiceResult<JobTitleDetail>> =>
  context.db.transaction((tx) => createJobTitleInTransactionImpl(tx, context, input))

/** 新增職稱。收外部交易 handle，給 `employees/onboarding` 編排點用（計畫 §4.1）。 */
export const createJobTitleInTransaction = (
  tx: TransactionRunner,
  context: JobTitlesMainContext,
  input: CreateJobTitleInput,
): Promise<ServiceResult<JobTitleDetail>> => createJobTitleInTransactionImpl(tx, context, input)

/** 修改職稱。自己開交易，給單一端點用。 */
export const updateJobTitle = (
  context: JobTitlesMainContext,
  input: UpdateJobTitleInput,
): Promise<ServiceResult<JobTitleDetail>> =>
  context.db.transaction((tx) => updateJobTitleInTransactionImpl(tx, context, input))

/** 刪除職稱（軟刪除）。自己開交易，給單一端點用。 */
export const deleteJobTitle = (
  context: JobTitlesMainContext,
  input: JobTitleTargetInput,
): Promise<ServiceResult<DeletedJobTitle>> =>
  context.db.transaction((tx) => deleteJobTitleInTransactionImpl(tx, context, input))
