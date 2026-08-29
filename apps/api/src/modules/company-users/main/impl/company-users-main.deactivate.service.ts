/**
 * 業務動作：停用員工的公司帳號（實作計畫 `plans/05-employee-onboarding.md` §7）。
 *
 * **本檔是 Stage 3 唯一嚴格遵守「收交易 handle 作為第一個參數、不得自己開交易」的寫入動作**
 * （§4.1 定案）：它不呼叫 `recordAudit`，因此沒有 `check:audit-transaction` 那個「`.transaction()`
 * 與 `recordAudit(` 必須同檔同回呼」的限制（見 `modules/employments/main/impl/
 * employments-main.create.service.ts` 檔頭對這個限制的完整說明）。呼叫端（離職流程）自己已經
 * 開著一個交易，把那個 `tx` 原樣傳進來即可；本動作只管停用這一件事，稽核由呼叫端負責
 * （它同時也在記任職異動的稽核，兩筆稽核與這裡的停用、任職狀態變更全部落在同一個交易裡）。
 *
 * **只做停用，不做別的**：不驗證「這是不是本次離職動作在呼叫」、不檢查任職狀態——那些是呼叫端
 * 的責任。這支動作收到「幫某位員工停用帳號」的指令就照做，找不到有效帳號時**不是錯誤**，
 * 是合法的空操作（見 repository 的說明：Stage 3 還沒有「新增員工同時建立帳號」的編排，
 * 一位員工完全可能沒有帳號）。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import { findActiveCompanyUserByEmployee, markCompanyUserDeactivated } from '../company-users-main.repository.ts'

export type CompanyUserDeactivation = {
  readonly companyUserId: string
} | null

/**
 * @param tx 呼叫端業務交易的 handle。**必須是交易物件**——這支動作不自己開交易（§4.1）。
 * @param now 台北牆鐘時間，**由呼叫端傳入而不是這裡自己取**：必須與呼叫端同一次操作寫下的其他
 *   時間戳（任職的 `updated_at`、稽核的 `created_at`）完全相同，理由與
 *   `company-users/roles/impl/company-users-roles.create.service.ts` 的 `assignedAt` 相同。
 * @returns 找不到有效帳號時回 `null`（合法的空操作，見檔頭）；停用成功回被停用的 `companyUserId`。
 */
export const deactivateCompanyUser = async (
  tx: QueryRunner,
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
  return { companyUserId: companyUser.id }
}
