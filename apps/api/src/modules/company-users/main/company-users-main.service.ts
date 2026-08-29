/**
 * 公司帳號成員關係的業務入口（§0.4）。
 *
 * 兩支都是**沒有端點的業務動作**（§0.4 明文允許）：{@link deactivateCompanyUser} 供離職流程呼叫；
 * {@link createCompanyUserInTransaction} 供 `employees/onboarding` 呼叫（實作計畫
 * `05-employee-onboarding.md` Stage 4）。本次目錄**仍然**沒有 `routes.ts`／`handler.ts`
 * ——這兩支動作都不是直接面對前端的端點，理由與 `modules/audit/main/` 相同（見該模組的
 * `audit-main.service.ts` 檔頭）。**但本次目錄現在有 `errors.ts`**：新增帳號會產生一種
 * 真正的業務拒絕（`username` 全域唯一撞鍵），不像 `deactivateCompanyUser` 那樣「找不到就是
 * 合法的空操作」，因此需要一份錯誤字典（§0.4：errors 不拆，理由見該檔）。
 */
import { deactivateCompanyUser as deactivateCompanyUserImpl } from './impl/company-users-main.deactivate.service.ts'
import type { CompanyUserDeactivation } from './impl/company-users-main.deactivate.service.ts'
import {
  createCompanyUserInTransaction as createCompanyUserInTransactionImpl,
  type CompanyUserCreation,
  type CreateCompanyUserInput,
} from './impl/company-users-main.create.service.ts'
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'

export type { CompanyUserCreation, CompanyUserDeactivation, CreateCompanyUserInput }

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
