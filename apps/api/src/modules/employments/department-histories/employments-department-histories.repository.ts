/** 部門歷史的資料存取入口（§0.4）。 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import type { DepartmentHistoryListPage, DepartmentHistoryListQuery } from './domain/department-history-model.ts'
import { findDepartmentForReference as findDepartmentForReferenceImpl } from './impl/employments-department-histories.find-department.repository.ts'
import { findEmploymentForUpdate as findEmploymentForUpdateImpl } from './impl/employments-department-histories.find-employment-for-update.repository.ts'
import {
  insertDepartmentHistory as insertDepartmentHistoryImpl,
  type NewDepartmentHistory,
} from './impl/employments-department-histories.insert.repository.ts'
import { listDepartmentHistoryPage as listDepartmentHistoryPageImpl } from './impl/employments-department-histories.list.repository.ts'
import { listDepartmentHistoryPeriods as listDepartmentHistoryPeriodsImpl } from './impl/employments-department-histories.list-periods.repository.ts'
import type { DepartmentHistoryInsertOutcome } from './domain/department-history-duplicate.ts'

export type { NewDepartmentHistory }
export type { QueryRunner }

export const findEmploymentForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string } | null> => findEmploymentForUpdateImpl(runner, companyId, employmentId)

export const findDepartmentForReference = (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
): Promise<{ readonly id: string } | null> => findDepartmentForReferenceImpl(runner, companyId, departmentId)

export const listDepartmentHistoryPeriods = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<readonly EffectivePeriod[]> => listDepartmentHistoryPeriodsImpl(runner, companyId, employmentId)

export const insertDepartmentHistory = (
  runner: QueryRunner,
  companyId: string,
  history: NewDepartmentHistory,
): Promise<DepartmentHistoryInsertOutcome> => insertDepartmentHistoryImpl(runner, companyId, history)

export const listDepartmentHistoryPage = (
  runner: QueryRunner,
  companyId: string,
  query: DepartmentHistoryListQuery,
): Promise<DepartmentHistoryListPage> => listDepartmentHistoryPageImpl(runner, companyId, query)
