/**
 * 業務動作：登出（§5.4.7）。
 *
 * **作廢整條輪替鏈，不是只作廢手上那一張。** 兩種做法在單分頁情境下效果相同，
 * 差別出在「手上的票不是最新那張」的時候——而多分頁是本系統的日常。
 * 完整的理由寫在 `impl/sessions-main.revoke-chain.repository.ts` 的檔頭。
 *
 * **登出同時讓 access token 立刻失效**（§5.4.6），而且不需要任何額外的動作：
 * 憑證驗證器每個請求都會問「這條鏈還有沒有未作廢的列」（`touch-session`），
 * 作廢之後那個答案就是「沒有」。**沒有殘留視窗，也沒有第二個地方要記得處理。**
 *
 * 這支端點的範圍是**當前這一條鏈**；§5.4.5 的「改密碼作廢所有 session」範圍是該使用者的所有鏈，
 * 兩者不重疊——後者屬於 `credentials/main/*`，本批次不做。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import type { RevocationOutcome } from '../domain/session-model.ts'
import { revokeSessionChain } from '../sessions-main.repository.ts'

/**
 * @param identity 已驗證身分。公司範圍與 `sessionId` 都來自 access token 的 claims，
 *   **不是 request body**（§1.5：端點只從 context 取用已驗證的身分）。
 *   因此「登出別人的 session」不是「要記得檢查」，是根本沒有欄位可以指定別人。
 */
export const logout = async (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<ServiceResult<RevocationOutcome>> => {
  const now = context.clock.now()

  const revokedCount = await revokeSessionChain(context.db, identity.companyId, identity.sessionId, {
    at: now,
    reason: RefreshTokenRevokeReason.Logout,
  })

  // **影響 0 列不是錯誤**（與 §4.4 的條件式 UPDATE 不同）：那代表這條鏈已經沒有有效票了
  //（重複按登出、或這條鏈剛剛被偷用偵測作廢掉）。這支端點要保證的是「這條鏈是死的」，
  // 而它確實是死的——回一個業務錯誤只會讓使用者在登出頁面看到一句他無法處理的訊息，
  // 而且他想做的事已經完成了。
  return succeed({ revokedCount })
}
