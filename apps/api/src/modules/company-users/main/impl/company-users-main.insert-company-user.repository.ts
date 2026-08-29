/**
 * 資料存取：新增公司成員關係（`company_users`，實作計畫 `05-employee-onboarding.md` Stage 4）。
 *
 * 唯一鍵 `uq_company_users_company_user`（`company_id`, `user_id`）在這裡不會撞——
 * `user_id` 是同一交易內剛插入的新 `users` 列（見 `impl/company-users-main.create.service.ts`），
 * 不可能與既有列相同。真的撞到只可能是 UUID 碰撞這種不該發生的事，因此不特別分類，
 * 原樣讓例外往上拋（§3.1.2：系統錯誤，不是業務拒絕）。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { CompanyUserStatus, companyUsers } from '../../../../db/schema/index.ts'

export type NewCompanyUser = {
  readonly id: string
  readonly userId: string
  readonly employeeId: string
  /** 台北牆鐘時間，由呼叫端注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertCompanyUser = async (
  runner: QueryRunner,
  companyId: string,
  companyUser: NewCompanyUser,
): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  await tenant.insert(companyUsers, (scopedCompanyId) => ({
    id: companyUser.id,
    companyId: scopedCompanyId,
    userId: companyUser.userId,
    employeeId: companyUser.employeeId,
    status: CompanyUserStatus.Active,
    activatedAt: companyUser.now,
    deactivatedAt: null,
    createdAt: companyUser.now,
    updatedAt: companyUser.now,
  }))
}
