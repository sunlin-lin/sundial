/**
 * 業務動作：偷用偵測觸發的全鏈作廢（§5.4.2）。
 *
 * **這個動作沒有對應的端點**，呼叫者是 refresh 群組的憑證驗證器（§0.4 允許沒有端點的業務動作）。
 *
 * **與「登出所有裝置」刻意分成兩個動作，即使兩者的資料操作完全相同。** 差別只有作廢原因
 * 那一欄，而那一欄是這件事唯一留下來的證據：`REUSE_DETECTED` 是**系統自己偵測到的安全事件**，
 * `LOGOUT_ALL` 是使用者主動按的按鈕。合併成一個動作、共用一個原因之後，
 * 事後翻資料庫再也分不出「這位使用者的票是被誰作廢的」——而 §5.4.2 要求偵測到重複使用時
 * 必須寫稽核與告警，那是少數「系統自己能發現的安全事件」，靜靜作廢等於浪費了這個訊號。
 *
 * 為什麼作廢範圍是「該成員的所有鏈」而不是「出事的那一條」：
 * 舊票再次出現代表同一張票有第二方持有，而**無法從單次請求判斷誰是誰**
 *（可能是攻擊者拿舊票來換，也可能是攻擊者已經換過而真正的使用者拿著舊票來）。
 * 也不需要判斷——兩邊一起作廢，被偷的一方最多重登一次，攻擊者則失去全部存取權。
 */
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import type { RevocationOutcome } from '../domain/session-model.ts'
import { revokeMemberChains } from '../sessions-main.repository.ts'

/**
 * 回傳的**不是** `ServiceResult`：這個動作沒有任何業務規則可以不成立，
 * 而且它的呼叫者是憑證驗證器——那一層不會把結果映射成 envelope（它一律回 `900`）。
 * 包一層 `ServiceResult` 只會讓驗證器多寫一段永遠走不到的失敗分支。
 */
export const revokeChainsOnReuse = async (
  context: SessionsMainContext,
  identity: VerifiedIdentity,
): Promise<RevocationOutcome> => {
  const now = context.clock.now()

  const revokedCount = await revokeMemberChains(context.db, identity.companyId, identity.companyUserId, {
    at: now,
    reason: RefreshTokenRevokeReason.ReuseDetected,
  })

  return { revokedCount }
}
