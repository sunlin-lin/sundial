/**
 * 職稱主檔的資料存取入口（§0.4）。形狀比照 `departments/main/departments-main.repository.ts`。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { JobTitleDetail, JobTitleListPage, JobTitleListQuery } from './domain/job-title-model.ts'
import { findJobTitleDetail as findJobTitleDetailImpl } from './impl/job-titles-main.find.repository.ts'
import { insertJobTitle as insertJobTitleImpl, type NewJobTitle } from './impl/job-titles-main.insert.repository.ts'
import { listJobTitlePage as listJobTitlePageImpl } from './impl/job-titles-main.list.repository.ts'
import {
  markJobTitleDeleted as markJobTitleDeletedImpl,
  type JobTitleDeletion,
} from './impl/job-titles-main.mark-deleted.repository.ts'
import {
  updateJobTitleProfile as updateJobTitleProfileImpl,
  type JobTitleProfileUpdate,
  type JobTitleProfileUpdateOutcome,
} from './impl/job-titles-main.update-profile.repository.ts'
import type { JobTitleInsertOutcome } from './domain/job-title-duplicate.ts'

export type { JobTitleDeletion, JobTitleProfileUpdate, JobTitleProfileUpdateOutcome, NewJobTitle }
export type { QueryRunner }

export const findJobTitleDetail = (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
): Promise<JobTitleDetail | null> => findJobTitleDetailImpl(runner, companyId, jobTitleId)

export const listJobTitlePage = (
  runner: QueryRunner,
  companyId: string,
  query: JobTitleListQuery,
): Promise<JobTitleListPage> => listJobTitlePageImpl(runner, companyId, query)

export const insertJobTitle = (
  runner: QueryRunner,
  companyId: string,
  jobTitle: NewJobTitle,
): Promise<JobTitleInsertOutcome> => insertJobTitleImpl(runner, companyId, jobTitle)

export const updateJobTitleProfile = (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
  update: JobTitleProfileUpdate,
): Promise<JobTitleProfileUpdateOutcome> => updateJobTitleProfileImpl(runner, companyId, jobTitleId, update)

export const markJobTitleDeleted = (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
  deletion: JobTitleDeletion,
): Promise<number> => markJobTitleDeletedImpl(runner, companyId, jobTitleId, deletion)
