/**
 * 公司帳號成員關係的業務入口（§0.4）。
 *
 * {@link deactivateCompanyUser} 與 {@link createCompanyUserInTransaction} 是**沒有端點的業務
 * 動作**（§0.4 明文允許）：前者供離職流程呼叫，後者供 `employees/onboarding` 呼叫（實作計畫
 * `05-employee-onboarding.md` Stage 4）。**{@link resetCompanyUserPassword}、
 * {@link activateCompanyUserAccount}、{@link deactivateCompanyUserAccount} 不同：都有自己的
 * 端點**（`/company-users/main/{reset-password,activate,deactivate}`，UI 定案
 * `docs/ui/20-employee-list.md` §3.5），因此本次目錄現在有 `routes.ts`／`handler.ts`——理由與
 * `company-users/roles` 的 `create`／`revoke` 相同：一旦某個動作要被前端直接呼叫，它就不再只是
 * 「編排點內部呼叫的業務動作」，需要完整的六層。
 *
 * `activateCompanyUserAccount`／`deactivateCompanyUserAccount` 與既有的
 * `deactivateCompanyUser` 是**三個不同的動作**，不是同一件事的兩種寫法：後者是離職流程專用、
 * 以 `employeeId` 尋找有效帳號、不記稽核的內部動作；前兩者是本輪新增、給端點用、各自處理自我
 * 操作檢查與冪等後自己記稽核的動作。完整分工說明見
 * `impl/company-users-main.deactivate-account.service.ts` 檔頭。
 */
import {
  activateCompanyUserAccountInTransaction as activateCompanyUserAccountInTransactionImpl,
  type ActivateCompanyUserAccountInput,
  type CompanyUserAccountActivation,
} from './impl/company-users-main.activate-account.service.ts'
import { deactivateCompanyUser as deactivateCompanyUserImpl } from './impl/company-users-main.deactivate.service.ts'
import type { CompanyUserDeactivation } from './impl/company-users-main.deactivate.service.ts'
import {
  deactivateCompanyUserAccountInTransaction as deactivateCompanyUserAccountInTransactionImpl,
  type CompanyUserAccountDeactivation,
  type DeactivateCompanyUserAccountInput,
} from './impl/company-users-main.deactivate-account.service.ts'
import {
  createCompanyUserInTransaction as createCompanyUserInTransactionImpl,
  type CompanyUserCreation,
  type CreateCompanyUserInput,
} from './impl/company-users-main.create.service.ts'
import {
  resetCompanyUserPasswordInTransaction as resetCompanyUserPasswordInTransactionImpl,
  type CompanyUserPasswordReset,
  type ResetCompanyUserPasswordInput,
} from './impl/company-users-main.reset-password.service.ts'
import type { Database, TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'

export type {
  ActivateCompanyUserAccountInput,
  CompanyUserAccountActivation,
  CompanyUserAccountDeactivation,
  CompanyUserCreation,
  CompanyUserDeactivation,
  CompanyUserPasswordReset,
  CreateCompanyUserInput,
  DeactivateCompanyUserAccountInput,
  ResetCompanyUserPasswordInput,
}

export const deactivateCompanyUser = (
  tx: TransactionRunner,
  companyId: string,
  employeeId: string,
  now: string,
): Promise<CompanyUserDeactivation> => deactivateCompanyUserImpl(tx, companyId, employeeId, now)

/**
 * 新增登入帳號並加入公司。**收外部交易 handle，不自己開交易**（計畫 §4.1），
 * 給 `employees/onboarding` 編排點用。完整規則見 `impl/company-users-main.create.service.ts` 檔頭。
 */
export const createCompanyUserInTransaction = (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: CreateCompanyUserInput,
  now: string,
): Promise<ServiceResult<CompanyUserCreation>> =>
  createCompanyUserInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now)

/**
 * 重設公司成員的登入密碼。**自己開交易**，給 `/company-users/main/reset-password` 端點用；
 * 差別見 `employees-main.service.ts` 的 `createEmployee` 說明。
 */
export const resetCompanyUserPassword = (
  db: Database,
  companyId: string,
  operatorCompanyUserId: string,
  input: ResetCompanyUserPasswordInput,
  now: string,
): Promise<ServiceResult<CompanyUserPasswordReset>> =>
  db.transaction((tx) => resetCompanyUserPasswordInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now))

/** 重設公司成員的登入密碼。收外部交易 handle，給編排點用；差別見 {@link createCompanyUserInTransaction} 的說明。 */
export const resetCompanyUserPasswordInTransaction = (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: ResetCompanyUserPasswordInput,
  now: string,
): Promise<ServiceResult<CompanyUserPasswordReset>> =>
  resetCompanyUserPasswordInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now)

/**
 * 啟用一位員工的登入帳號。**自己開交易**，給 `/company-users/main/activate` 端點用；
 * 差別見 `employees-main.service.ts` 的 `createEmployee` 說明。完整規則見
 * `impl/company-users-main.activate-account.service.ts` 檔頭。
 */
export const activateCompanyUserAccount = (
  db: Database,
  companyId: string,
  operatorCompanyUserId: string,
  input: ActivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountActivation>> =>
  db.transaction((tx) => activateCompanyUserAccountInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now))

/** 啟用一位員工的登入帳號。收外部交易 handle，給編排點用；目前沒有呼叫者，比照既有動作留這個變體備用。 */
export const activateCompanyUserAccountInTransaction = (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: ActivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountActivation>> =>
  activateCompanyUserAccountInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now)

/**
 * 停用一位員工的登入帳號（管理者直接操作，非離職流程）。**自己開交易**，給
 * `/company-users/main/deactivate` 端點用。**不要與 {@link deactivateCompanyUser} 混淆**
 * ——後者是離職流程專用的內部動作，完整分工見
 * `impl/company-users-main.deactivate-account.service.ts` 檔頭。
 */
export const deactivateCompanyUserAccount = (
  db: Database,
  companyId: string,
  operatorCompanyUserId: string,
  input: DeactivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountDeactivation>> =>
  db.transaction((tx) =>
    deactivateCompanyUserAccountInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now),
  )

/** 停用一位員工的登入帳號。收外部交易 handle，給編排點用；目前沒有呼叫者，比照既有動作留這個變體備用。 */
export const deactivateCompanyUserAccountInTransaction = (
  tx: TransactionRunner,
  companyId: string,
  operatorCompanyUserId: string,
  input: DeactivateCompanyUserAccountInput,
  now: string,
): Promise<ServiceResult<CompanyUserAccountDeactivation>> =>
  deactivateCompanyUserAccountInTransactionImpl(tx, companyId, operatorCompanyUserId, input, now)
