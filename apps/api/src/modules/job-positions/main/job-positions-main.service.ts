/** 職務主檔的業務入口（§0.4）。形狀比照 `job-titles/main/job-titles-main.service.ts`。 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { JobPositionsMainContext } from './domain/job-position-context.ts'
import type {
  CreateJobPositionInput,
  DeletedJobPosition,
  JobPositionDetail,
  JobPositionListPage,
  JobPositionListQuery,
  JobPositionTargetInput,
  UpdateJobPositionInput,
} from './domain/job-position-model.ts'
import { createJobPositionInTransaction as createJobPositionInTransactionImpl } from './impl/job-positions-main.create.service.ts'
import { deleteJobPositionInTransaction as deleteJobPositionInTransactionImpl } from './impl/job-positions-main.delete.service.ts'
import { getJobPosition as getJobPositionImpl } from './impl/job-positions-main.get.service.ts'
import { listJobPositions as listJobPositionsImpl } from './impl/job-positions-main.list.service.ts'
import { updateJobPositionInTransaction as updateJobPositionInTransactionImpl } from './impl/job-positions-main.update.service.ts'

export type { JobPositionsMainContext }
export type {
  CreateJobPositionInput,
  DeletedJobPosition,
  JobPositionDetail,
  JobPositionListPage,
  JobPositionListQuery,
  JobPositionTargetInput,
  UpdateJobPositionInput,
} from './domain/job-position-model.ts'

export const listJobPositions = (
  context: JobPositionsMainContext,
  query: JobPositionListQuery,
): Promise<ServiceResult<JobPositionListPage>> => listJobPositionsImpl(context, query)

export const getJobPosition = (
  context: JobPositionsMainContext,
  input: JobPositionTargetInput,
): Promise<ServiceResult<JobPositionDetail | null>> => getJobPositionImpl(context, input)

export const createJobPosition = (
  context: JobPositionsMainContext,
  input: CreateJobPositionInput,
): Promise<ServiceResult<JobPositionDetail>> =>
  context.db.transaction((tx) => createJobPositionInTransactionImpl(tx, context, input))

export const updateJobPosition = (
  context: JobPositionsMainContext,
  input: UpdateJobPositionInput,
): Promise<ServiceResult<JobPositionDetail>> =>
  context.db.transaction((tx) => updateJobPositionInTransactionImpl(tx, context, input))

export const deleteJobPosition = (
  context: JobPositionsMainContext,
  input: JobPositionTargetInput,
): Promise<ServiceResult<DeletedJobPosition>> =>
  context.db.transaction((tx) => deleteJobPositionInTransactionImpl(tx, context, input))
