/** 職稱歷史的資料存取入口（§0.4）。形狀比照 `department-histories/employments-department-histories.repository.ts`。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import type { JobTitleHistoryListPage, JobTitleHistoryListQuery } from './domain/job-title-history-model.ts'
import { findEmploymentForUpdate as findEmploymentForUpdateImpl } from './impl/employments-job-title-histories.find-employment-for-update.repository.ts'
import { findJobTitleForReference as findJobTitleForReferenceImpl } from './impl/employments-job-title-histories.find-job-title.repository.ts'
import {
  insertJobTitleHistory as insertJobTitleHistoryImpl,
  type NewJobTitleHistory,
} from './impl/employments-job-title-histories.insert.repository.ts'
import { listJobTitleHistoryPage as listJobTitleHistoryPageImpl } from './impl/employments-job-title-histories.list.repository.ts'
import { listJobTitleHistoryPeriods as listJobTitleHistoryPeriodsImpl } from './impl/employments-job-title-histories.list-periods.repository.ts'
import type { JobTitleHistoryInsertOutcome } from './domain/job-title-history-duplicate.ts'

export type { NewJobTitleHistory }
export type { QueryRunner }

export const findEmploymentForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string } | null> => findEmploymentForUpdateImpl(runner, companyId, employmentId)

export const findJobTitleForReference = (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
): Promise<{ readonly id: string } | null> => findJobTitleForReferenceImpl(runner, companyId, jobTitleId)

export const listJobTitleHistoryPeriods = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<readonly EffectivePeriod[]> => listJobTitleHistoryPeriodsImpl(runner, companyId, employmentId)

export const insertJobTitleHistory = (
  runner: QueryRunner,
  companyId: string,
  history: NewJobTitleHistory,
): Promise<JobTitleHistoryInsertOutcome> => insertJobTitleHistoryImpl(runner, companyId, history)

export const listJobTitleHistoryPage = (
  runner: QueryRunner,
  companyId: string,
  query: JobTitleHistoryListQuery,
): Promise<JobTitleHistoryListPage> => listJobTitleHistoryPageImpl(runner, companyId, query)
