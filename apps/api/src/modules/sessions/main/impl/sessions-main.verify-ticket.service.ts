/**
 * 業務動作：驗證並**消耗**一張 refresh 票（§5.4.2 的一次性輪替 ＋ 偷用偵測）。
 *
 * **這個動作沒有對應的端點**，呼叫者是 refresh 群組的憑證驗證器（§0.4 明文允許：
 * 「沒有端點的業務動作一樣放在入口檔，因為它同樣是這個次實體對外的介面，只是呼叫者不是前端」）。
 *
 * **回傳的不是 `ServiceResult`，這是刻意的**：三種結果沒有一種是「業務規則不允許」。
 * 它們全部都是「憑證的狀態」，而憑證不可用**永遠不是業務錯誤**（§3.1.1）——
 * service 不得表達它，`ErrorGroup` 也不為它新增第四個分組。把 `invalid` 包成一筆 `DomainError`
 * 的話，`900` 就有了第二個產出點（§1.3），而那個產出點不受續期規則約束、
 * 不保證 `expiresIn` 為 `null`、也不保證 `errors` 為空。
 *
 * **驗證與消耗在同一個交易、同一次條件式 UPDATE 裡完成**（§4.4）。拆開的後果寫在
 * `impl/sessions-main.consume-ticket.repository.ts` 的檔頭：兩個併發請求會各自換到一張新票，
 * 而偷用偵測在它最該生效的情境下剛好失效。
 */
import type { RefreshTicketVerification } from '../../../../shared/access-control.ts'
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { hashTicket, ticketHashMatches, verifyRefreshTicketSignature } from '../domain/session-token.ts'
import { consumeRefreshTicket, findRefreshTicket } from '../sessions-main.repository.ts'

export const verifyRefreshTicket = async (
  context: SessionsMainContext,
  rawTicket: string,
): Promise<RefreshTicketVerification> => {
  // 第一關：這串字是不是我們簽的、而且簽的是一張 refresh 票（不是 access token，§5.4.1）。
  // 簽章不符時**不查資料庫**：讓任何人用亂造的字串就能觸發一次查詢，等於送一個免費的放大器。
  const claims = verifyRefreshTicketSignature(context.session.accessTokenSecret, rawTicket)
  if (claims === null) return { outcome: 'invalid' }

  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<RefreshTicketVerification> => {
    // 公司範圍來自票上經過簽章的 claims（§4.2 的信任方向：伺服器簽發的值，不是客戶端說了算）。
    const stored = await findRefreshTicket(tx, claims.companyId, claims.ticketId)
    if (stored === null) return { outcome: 'invalid' }

    // 第二關：這串字就是我們發給**這一列**的那一串。簽章金鑰一旦外洩，攻擊者可以自己簽一張
    // 指向任何 `id` 的票——這一步讓他還得猜中那一列的原值。定時比較，理由見 session-token.ts。
    if (!ticketHashMatches(stored.tokenHash, hashTicket(rawTicket))) return { outcome: 'invalid' }

    // 身分一律由**資料庫那一列**解析，不用票上的值：票上的值不會隨著作廢狀態改變，
    // 而全鏈作廢的範圍必須以資料為準（`company_user_id`）。
    const identity = {
      sessionId: stored.sessionId,
      userId: stored.userId,
      companyId: claims.companyId,
      companyUserId: stored.companyUserId,
    }

    if (stored.revokedAt !== null) {
      // §5.4.2：**已作廢的票再次被使用 → 一律視為外洩**。不區分它當初是為什麼被作廢
      //（輪替、登出、上一次的偷用偵測）——「一律」是規範的用字，而且它讓這裡沒有分支可以寫錯。
      // 全鏈作廢的動作由驗證器負責（副作用集中在入口層，見 `http/refresh-guard.ts`）。
      return { outcome: 'reuse-detected', identity }
    }

    // 鏈的絕對截止（§5.4.1 的 30 天）。過期**不是**偷用：正常使用者放著不用滿 30 天就會走到這裡，
    // 把它當成外洩會讓他在別的裝置上的登入也一起被踢掉。
    if (stored.expiresAt <= now) return { outcome: 'invalid' }

    const consumed = await consumeRefreshTicket(tx, claims.companyId, claims.ticketId, {
      at: now,
      reason: RefreshTokenRevokeReason.Rotated,
    })

    if (consumed === 0) {
      // 讀到「未作廢」與寫入之間，別人已經把這張票用掉了——兩個持有者同時在用同一張票，
      // 那正是 §5.4.2 描述的情形。與上面那條 `revokedAt !== null` 走同一種處置。
      return { outcome: 'reuse-detected', identity }
    }

    return { outcome: 'valid', identity, ticketId: claims.ticketId }
  })
}
