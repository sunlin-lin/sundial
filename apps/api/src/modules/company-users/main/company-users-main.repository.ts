/**
 * 公司帳號成員關係的資料存取入口（§0.4）。
 */
import type { QueryRunner } from '../../../db/client.ts'
import { findActiveCompanyUserByEmployee as findActiveCompanyUserByEmployeeImpl } from './impl/company-users-main.find-active-by-employee.repository.ts'
import { markCompanyUserDeactivated as markCompanyUserDeactivatedImpl } from './impl/company-users-main.mark-deactivated.repository.ts'

export type { QueryRunner }

export const findActiveCompanyUserByEmployee = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findActiveCompanyUserByEmployeeImpl(runner, companyId, employeeId)

export const markCompanyUserDeactivated = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  deactivatedAt: string,
): Promise<number> => markCompanyUserDeactivatedImpl(runner, companyId, companyUserId, deactivatedAt)
