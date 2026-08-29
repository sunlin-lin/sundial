/**
 * 業務動作：停用員工的公司帳號（實作計畫 `plans/05-employee-onboarding.md` §7）。
 *
 * **本檔是最早就遵守「收交易 handle 作為第一個參數、不得自己開交易」的寫入動作**（§4.1 定案）：
 * 它不呼叫 `recordAudit`，稽核由呼叫端負責（它同時也在記任職異動的稽核，兩筆稽核與這裡的停用、
 * 任職狀態變更全部落在同一個交易裡）。呼叫端（離職流程）自己已經開著一個交易，把那個 `tx`
 * 原樣傳進來即可。
 *
 * 型別是 `TransactionRunner`（`db/client.ts`），不是單純的 `QueryRunner`——後者連線池與交易物件
 * 都滿足，會讓呼叫端不小心傳一個裸連線池進來也編譯得過；`TransactionRunner` 讓那件事變成
 * 編譯錯誤，理由與 `recordAudit` 改用同一個型別完全一樣（見 `db/client.ts` 的 `TransactionRunner`
 * 檔頭）。**本檔沒有另外提供「自己開交易」的版本**：它從來就只被離職流程這一個已經在交易內的
 * 呼叫端使用，沒有需要區分兩種呼叫形狀的場景（不像 `employees/main` 等動作，既有單一端點、
 * 也會被 Stage 4 編排）。
 *
 * **只做停用，不做別的**：不驗證「這是不是本次離職動作在呼叫」、不檢查任職狀態——那些是呼叫端
 * 的責任。這支動作收到「幫某位員工停用帳號」的指令就照做，找不到有效帳號時**不是錯誤**，
 * 是合法的空操作（見 repository 的說明：Stage 3 還沒有「新增員工同時建立帳號」的編排，
 * 一位員工完全可能沒有帳號）。
 *
 * **同時作廢該成員的所有 refresh token 鏈**（安全落差修補）：company_users.status 只在登入
 * 那一刻被檢查，access token 續期與 refresh 都不查，停用帳號後舊票原本會一直有效到期、
 * refresh 票甚至還能繼續換出新的 access token。呼叫 sessions 模組的
 * revokeSessionsForDeactivation（傳入同一個 tx，見該檔頭）補上這一步，讓停用立即生效。
 * **company-users 依賴 sessions 不是新方向**：create.service.ts／reset-password.service.ts
 * 早就在用 sessions 的 hashPassword，這裡是同一個方向的第三個用途。sessions 本身不 import
 * company-users（也不 import employments），方向不會形成循環。
 *
 * 作廢後的 token id 清單不在這裡記稽核——本檔本來就不呼叫 recordAudit（見上方「不做的事」），
 * 回傳給呼叫端（離職流程）併進它自己那一筆 company_users 稽核的 revokedTokenIds 欄位，
 * 避免同一次停用被兩筆稽核各自描述一次。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { revokeSessionsForDeactivation } from '../../../sessions/index.ts'
import { findActiveCompanyUserByEmployee, markCompanyUserDeactivated } from '../company-users-main.repository.ts'

export type CompanyUserDeactivation = {
  readonly companyUserId: string
  /** 這次停用同步作廢的 refresh token id 清單，供呼叫端併入自己的稽核 changes（見檔頭）。 */
  readonly revokedTokenIds: readonly string[]
} | null

/**
 * @param tx 呼叫端業務交易的 handle。**必須是交易物件**——這支動作不自己開交易（§4.1）。
 * @param now 台北牆鐘時間，**由呼叫端傳入而不是這裡自己取**：必須與呼叫端同一次操作寫下的其他
 *   時間戳（任職的 `updated_at`、稽核的 `created_at`）完全相同，理由與
 *   `company-users/roles/impl/company-users-roles.create.service.ts` 的 `assignedAt` 相同。
 * @returns 找不到有效帳號時回 `null`（合法的空操作，見檔頭）；停用成功回被停用的 `companyUserId`
 *   與這次一併作廢的 `revokedTokenIds`。
 */
export const deactivateCompanyUser = async (
  tx: TransactionRunner,
  companyId: string,
  employeeId: string,
  now: string,
): Promise<CompanyUserDeactivation> => {
  const companyUser = await findActiveCompanyUserByEmployee(tx, companyId, employeeId)
  if (companyUser === null) return null

  // 條件式 UPDATE 影響 0 列的情況（§4.4）：理論上不會發生（見 repository 檔頭），
  // 就算發生也不是這支動作要處理的業務拒絕——它只是「已經停用了」，靜默視為完成即可，
  // 不需要另開一個錯誤碼去描述一個對使用者沒有意義的競態。
  await markCompanyUserDeactivated(tx, companyId, companyUser.id, now)
  // 同一筆交易內作廢所有 session（安全落差修補，見檔頭）。
  const revokedTokenIds = await revokeSessionsForDeactivation(tx, companyId, companyUser.id, now)
  return { companyUserId: companyUser.id, revokedTokenIds }
}
