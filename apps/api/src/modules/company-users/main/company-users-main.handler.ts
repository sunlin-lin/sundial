/**
 * `company-users/main` 的端點 handler（§1.8.0 的④與⑥）。目前只有一支：重設密碼。
 *
 * 形狀比照同一個大目錄下 `company-users/roles` 的 handler：`set.status` 由呼叫端（routes.ts）
 * 依 `BoundaryResponse.status` 設定，本檔不碰 envelope、不自行填 `code`／`rspTS`（§1.8.2）。
 *
 * **本層不持有密碼明文超過一次函式呼叫**：`request.newPassword` 只往下傳給 service，
 * 不進 log、不進任何中繼變數（§5.1）。
 */
import { resolveServiceResult, type BoundaryResponse } from '../../../http/error-boundary.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { Clock } from '../../../shared/clock.ts'
import type { Database } from '../../../db/client.ts'
import type { CompanyUserPasswordReset } from './company-users-main.service.ts'
import { resetCompanyUserPassword } from './company-users-main.service.ts'

/**
 * 由組裝點注入的相依。**公司範圍與操作者都不在裡面**——兩者只能來自每一次請求的已驗證身分
 * （§4.2、稽核計畫 §5），理由與 `company-users/roles` 的 `CompanyUsersRolesDependencies` 相同。
 */
export type CompanyUsersMainDependencies = {
  readonly database: Database
  readonly clock: Clock
}

/** 重設密碼端點的 request（只列 handler 真的會用到的欄位）。 */
export type ResetPasswordRequest = {
  readonly companyUserId: string
  readonly newPassword: string
}

/** 狀態變更端點的 `data`。**只回識別碼，不回任何密碼相關的東西**（§5.1）。 */
export type PasswordResetView = {
  readonly companyUserId: string
}

/** service 的結果 → 端點的 `data`。逐欄寫出來，不把 service 的回傳值直接指派給 `data`（§2）。 */
const toPasswordResetView = (reset: CompanyUserPasswordReset): PasswordResetView => ({
  companyUserId: reset.companyUserId,
})

/**
 * `POST /company-users/main/reset-password`。
 *
 * 操作者與公司範圍一律由已驗證身分推導，不信任請求帶來的任何識別碼（§4.2、§5.2）。
 */
export const resetPasswordHandler = async (
  dependencies: CompanyUsersMainDependencies,
  identity: VerifiedIdentity,
  request: ResetPasswordRequest,
): Promise<BoundaryResponse<PasswordResetView> | BoundaryResponse<null>> => {
  const result = await resetCompanyUserPassword(
    dependencies.database,
    identity.companyId,
    identity.companyUserId,
    { companyUserId: request.companyUserId, newPassword: request.newPassword },
    dependencies.clock.now(),
  )

  return resolveServiceResult(result, toPasswordResetView)
}
