/**
 * 公司帳號成員關係的資料存取入口（§0.4）。
 */
import type { QueryRunner } from '../../../db/client.ts'
import { findActiveCompanyUserByEmployee as findActiveCompanyUserByEmployeeImpl } from './impl/company-users-main.find-active-by-employee.repository.ts'
import { findCompanyUserById as findCompanyUserByIdImpl } from './impl/company-users-main.find-by-id.repository.ts'
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
import {
  updateUserPassword as updateUserPasswordImpl,
  type PasswordUpdate,
} from './impl/company-users-main.update-password.repository.ts'

export type { QueryRunner }
export type { NewCompanyUser, NewUser, PasswordUpdate, UserInsertOutcome }

export const findActiveCompanyUserByEmployee = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findActiveCompanyUserByEmployeeImpl(runner, companyId, employeeId)

/** 依 id 查一位公司成員，取回所屬的登入帳號 id。實作計畫 `05-employee-onboarding.md`（重設密碼）。 */
export const findCompanyUserById = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<{ readonly id: string; readonly userId: string } | null> =>
  findCompanyUserByIdImpl(runner, companyId, companyUserId)

/** 更新登入帳號的密碼雜湊（管理者重設密碼）。 */
export const updateUserPassword = (runner: QueryRunner, userId: string, update: PasswordUpdate): Promise<void> =>
  updateUserPasswordImpl(runner, userId, update)

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
