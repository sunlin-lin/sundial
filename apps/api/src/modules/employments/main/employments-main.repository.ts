/**
 * 任職主檔的資料存取入口（§0.4）。形狀與理由比照 `departments-main.repository.ts`，不重述。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { EmploymentDetail, EmploymentListPage, EmploymentListQuery } from './domain/employment-model.ts'
import type { EffectivePeriod } from '../../../shared/effective-period.ts'
import { findEmployeeForUpdate as findEmployeeForUpdateImpl } from './impl/employments-main.find-employee-for-update.repository.ts'
import { findEmploymentDetail as findEmploymentDetailImpl } from './impl/employments-main.find.repository.ts'
import {
  insertEmployment as insertEmploymentImpl,
  type NewEmployment,
} from './impl/employments-main.insert.repository.ts'
import { listEmploymentPage as listEmploymentPageImpl } from './impl/employments-main.list.repository.ts'
import { listEmployeeEmploymentPeriods as listEmployeeEmploymentPeriodsImpl } from './impl/employments-main.list-periods.repository.ts'
import {
  markEmploymentLeft as markEmploymentLeftImpl,
  type LeaveUpdate,
} from './impl/employments-main.update-leave.repository.ts'
import type { EmploymentInsertOutcome } from './domain/employment-duplicate.ts'

export type { LeaveUpdate, NewEmployment }
export type { QueryRunner }

export const findEmployeeForUpdate = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findEmployeeForUpdateImpl(runner, companyId, employeeId)

export const findEmploymentDetail = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<EmploymentDetail | null> => findEmploymentDetailImpl(runner, companyId, employmentId)

export const listEmployeeEmploymentPeriods = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<readonly EffectivePeriod[]> => listEmployeeEmploymentPeriodsImpl(runner, companyId, employeeId)

export const insertEmployment = (
  runner: QueryRunner,
  companyId: string,
  employment: NewEmployment,
): Promise<EmploymentInsertOutcome> => insertEmploymentImpl(runner, companyId, employment)

export const listEmploymentPage = (
  runner: QueryRunner,
  companyId: string,
  query: EmploymentListQuery,
): Promise<EmploymentListPage> => listEmploymentPageImpl(runner, companyId, query)

export const markEmploymentLeft = (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  update: LeaveUpdate,
): Promise<number> => markEmploymentLeftImpl(runner, companyId, employmentId, update)
