/**
 * 公司帳號成員關係的資料存取入口（§0.4）。
 */
import type { QueryRunner } from '../../../db/client.ts'
import { findActiveCompanyUserByEmployee as findActiveCompanyUserByEmployeeImpl } from './impl/company-users-main.find-active-by-employee.repository.ts'
import {
  insertCompanyUser as insertCompanyUserImpl,
  type NewCompanyUser,
} from './impl/company-users-main.insert-company-user.repository.ts'
import {
  insertUser as insertUserImpl,
  type NewUser,
  type UserInsertOutcome,
} from './impl/company-users-main.insert-user.repository.ts'
import { markCompanyUserDeactivated as markCompanyUserDeactivatedImpl } from './impl/company-users-main.mark-deactivated.repository.ts'

export type { QueryRunner }
export type { NewCompanyUser, NewUser, UserInsertOutcome }

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

/** 新增登入帳號（全域表 `users`，無公司範圍）。實作計畫 `05-employee-onboarding.md` Stage 4。 */
export const insertUser = (runner: QueryRunner, user: NewUser): Promise<UserInsertOutcome> =>
  insertUserImpl(runner, user)

/** 新增公司成員關係（`company_users`）。實作計畫 `05-employee-onboarding.md` Stage 4。 */
export const insertCompanyUser = (runner: QueryRunner, companyId: string, companyUser: NewCompanyUser): Promise<void> =>
  insertCompanyUserImpl(runner, companyId, companyUser)
