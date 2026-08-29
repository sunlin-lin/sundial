/** 職務歷史的資料存取入口（§0.4）。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import type { JobPositionHistoryListPage, JobPositionHistoryListQuery } from './domain/job-position-history-model.ts'
import { findEmploymentForReference as findEmploymentForReferenceImpl } from './impl/employments-job-position-histories.find-employment.repository.ts'
import { findJobPositionsForUpdate as findJobPositionsForUpdateImpl } from './impl/employments-job-position-histories.find-job-positions-for-update.repository.ts'
import {
  insertJobPositionHistories as insertJobPositionHistoriesImpl,
  type NewJobPositionHistory,
} from './impl/employments-job-position-histories.insert-many.repository.ts'
import { listJobPositionHistoryPage as listJobPositionHistoryPageImpl } from './impl/employments-job-position-histories.list.repository.ts'
import { listJobPositionHistoryPeriodsByJobPosition as listJobPositionHistoryPeriodsByJobPositionImpl } from './impl/employments-job-position-histories.list-periods.repository.ts'
import type { JobPositionHistoryInsertOutcome } from './domain/job-position-history-duplicate.ts'

export type { NewJobPositionHistory }
export type { QueryRunner }

export const findEmploymentForReference = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string } | null> => findEmploymentForReferenceImpl(runner, companyId, employmentId)

export const findJobPositionsForUpdate = (
  runner: QueryRunner,
  companyId: string,
  jobPositionIds: readonly string[],
): Promise<ReadonlySet<string>> => findJobPositionsForUpdateImpl(runner, companyId, jobPositionIds)

export const listJobPositionHistoryPeriodsByJobPosition = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  jobPositionIds: readonly string[],
): Promise<ReadonlyMap<string, readonly EffectivePeriod[]>> =>
  listJobPositionHistoryPeriodsByJobPositionImpl(runner, companyId, employmentId, jobPositionIds)

export const insertJobPositionHistories = (
  runner: QueryRunner,
  companyId: string,
  histories: readonly NewJobPositionHistory[],
): Promise<JobPositionHistoryInsertOutcome> => insertJobPositionHistoriesImpl(runner, companyId, histories)

export const listJobPositionHistoryPage = (
  runner: QueryRunner,
  companyId: string,
  query: JobPositionHistoryListQuery,
): Promise<JobPositionHistoryListPage> => listJobPositionHistoryPageImpl(runner, companyId, query)
