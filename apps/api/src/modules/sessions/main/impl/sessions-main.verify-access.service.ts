/**
 * 業務動作：驗證一張 access token（§1.9.1、§5.4.6）。
 *
 * **這個動作沒有對應的端點**，呼叫者是已登入群組的憑證驗證器（`http/identity-guard.ts`）。
 * 它落在入口檔而不是留在 `impl/`，正是 §0.4 那條「沒有端點的業務動作一樣放在入口檔」：
 * 它的呼叫者不是前端，但它確實是這個次實體對外的介面。
 *
 * **兩步驗證，缺一不可：**
 *
 * | 步驟 | 回答的問題 | 少了它會怎樣 |
 * |---|---|---|
 * | 驗簽 | 這串字是不是我們發的、上面寫著誰 | 任何人都能自己造一張票 |
 * | 查資料庫 | 這次登入還活著嗎、視窗滑到哪了 | **登出、改密碼、偷用偵測全部只是「過一陣子才生效」**（§5.4.6） |
 *
 * 第二步是 §5.4.6 的執行點，而那一節反覆強調的是「**不做跨請求快取**」。
 * 加了 TTL 快取之後那個殘留視窗在測試裡永遠是 0 秒、只在正式環境發作，
 * 而一個只在正式環境成立、且無法被測試證偽的安全行為，等於沒有這個行為。
 *
 * §5.4.6 的成本論證也要誠實記下來：規範說「額外成本接近零，因為驗證器本來就要查一次權限碼，
 * 撤銷狀態搭同一次查詢一起取回」。**本實作沒有做到「同一次查詢」**——撤銷狀態在
 * `refresh_tokens`（本模組），權限碼在 `company_user_roles`（`company-users` 模組），
 * 而跨大目錄的 join 會讓兩個模組的 repository 綁在一起（§0.3 禁止）。
 * 因此實際成本是每個請求多一次往返，不是多一個欄位。這個取捨已寫進交付回報。
 */
import type { VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { verifyAccessTokenSignature } from '../domain/session-token.ts'
import { touchAccessSession } from '../sessions-main.repository.ts'

/**
 * @returns 有效則回傳身分；**無效一律 `null` 而不是拋例外**——token 過期是預期中的事，
 *   不是意外（§3.1.2）；拋例外會讓它與「真的出事了」在告警上長得一模一樣。
 */
export const verifyAccessToken = async (
  context: SessionsMainContext,
  rawToken: string,
): Promise<VerifiedIdentity | null> => {
  // 驗簽不符時**不查資料庫**：讓任何人用亂造的字串就能觸發一次查詢，等於送一個免費的放大器。
  const claims = verifyAccessTokenSignature(context.session.accessTokenSecret, rawToken)
  if (claims === null) return null

  const now = context.clock.now()

  // 這一步同時做兩件事：確認這條鏈還活著（撤銷檢查），以及把滑動視窗往後推（續期，§1.3 來源①）。
  // 兩件事合在同一支資料存取動作，是因為它們必須看同一列、用同一個「現在」——
  // 分開之後，「檢查說還活著、續期卻推到另一列」這種錯誤沒有任何地方會變紅。
  const active = await touchAccessSession(
    context.db,
    // 公司範圍來自票上經過簽章的 claims，且**保證非 null**（§4.2：claims 的型別上就是必填的 string）。
    claims.companyId,
    claims.sessionId,
    now,
    context.clock.after(context.session.accessTokenTtlSeconds),
  )
  if (!active) return null

  return {
    sessionId: claims.sessionId,
    userId: claims.userId,
    companyId: claims.companyId,
    companyUserId: claims.companyUserId,
  }
}
