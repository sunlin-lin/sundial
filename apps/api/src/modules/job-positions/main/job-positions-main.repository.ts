/** 職務主檔的資料存取入口（§0.4）。形狀比照 `job-titles/main/job-titles-main.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { JobPositionDetail, JobPositionListPage, JobPositionListQuery } from './domain/job-position-model.ts'
import { findJobPositionDetail as findJobPositionDetailImpl } from './impl/job-positions-main.find.repository.ts'
import {
  insertJobPosition as insertJobPositionImpl,
  type NewJobPosition,
} from './impl/job-positions-main.insert.repository.ts'
import { listJobPositionPage as listJobPositionPageImpl } from './impl/job-positions-main.list.repository.ts'
import {
  markJobPositionDeleted as markJobPositionDeletedImpl,
  type JobPositionDeletion,
} from './impl/job-positions-main.mark-deleted.repository.ts'
import {
  updateJobPositionProfile as updateJobPositionProfileImpl,
  type JobPositionProfileUpdate,
  type JobPositionProfileUpdateOutcome,
} from './impl/job-positions-main.update-profile.repository.ts'
import type { JobPositionInsertOutcome } from './domain/job-position-duplicate.ts'

export type { JobPositionDeletion, JobPositionProfileUpdate, JobPositionProfileUpdateOutcome, NewJobPosition }
export type { QueryRunner }

export const findJobPositionDetail = (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
): Promise<JobPositionDetail | null> => findJobPositionDetailImpl(runner, companyId, jobPositionId)

export const listJobPositionPage = (
  runner: QueryRunner,
  companyId: string,
  query: JobPositionListQuery,
): Promise<JobPositionListPage> => listJobPositionPageImpl(runner, companyId, query)

export const insertJobPosition = (
  runner: QueryRunner,
  companyId: string,
  jobPosition: NewJobPosition,
): Promise<JobPositionInsertOutcome> => insertJobPositionImpl(runner, companyId, jobPosition)

export const updateJobPositionProfile = (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
  update: JobPositionProfileUpdate,
): Promise<JobPositionProfileUpdateOutcome> => updateJobPositionProfileImpl(runner, companyId, jobPositionId, update)

export const markJobPositionDeleted = (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
  deletion: JobPositionDeletion,
): Promise<number> => markJobPositionDeletedImpl(runner, companyId, jobPositionId, deletion)
