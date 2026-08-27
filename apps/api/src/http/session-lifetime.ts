/**
 * 端點與請求上下文之間的四個寫入點（§1.3、§1.9.0）。
 *
 * **這一層存在的理由：端點需要影響 envelope 的 `expiresIn`／`exp`，但不得自己填那兩欄**（§1.8.2）。
 * 唯一合法的形狀是「端點觸發發證元件 → 把結果放進請求上下文那一格 → 出口層讀那一格填欄位」，
 * 而中間那一步如果讓每支 handler 各自 `requestContext.session = { ... }` 手寫，
 * 就會出現三種寫法：有人忘了設、有人設成 `undefined`、有人順手把 `expiresIn` 也算了一次。
 * 收成四個具名函式之後，端點能做的事只有這四件，而且每一件都說得出自己是 §1.3 的哪一列。
 *
 * 本檔**不計算任何秒數**：`SessionRenewal` 由 access token 生命週期元件算好交進來
 *（§1.3「不得有第二份實作，也不得由呼叫者自行帶入秒數」）。這裡只搬運。
 */
import type { SessionRenewal, VerifiedIdentity } from '../shared/access-control.ts'
import type { RequestContext } from './request-context.ts'

/**
 * 發證（§1.3 來源②）：本次請求簽發了一張**新的** access token。
 *
 * 寫進的是與續期**同一格**（見 `request-context.ts`），因此不需要任何「誰贏」的判斷
 * ——同一次請求不會同時發生續期與發證。
 *
 * @param lifetime 新票的**完整壽命**，不是剩餘秒數：這張票這一刻才發出來，兩者相同，
 *   但寫成「剩餘」會讓下一個人以為要扣掉什麼。
 */
export const recordIssuedSession = (
  requestContext: RequestContext,
  identity: VerifiedIdentity,
  lifetime: SessionRenewal,
): void => {
  requestContext.session = { identity, renewal: lifetime }
}

/**
 * 登出成功（§1.3 的 `expiresIn` 取值表：登出成功一律 `null`）。
 *
 * 為什麼必須主動清掉：登出端點落在已登入群組，憑證驗證器在①的時候**已經續期過了**
 *（那是結構性的，§1.8.0：續期發生在驗證通過的當下，還不知道這支端點要做什麼）。
 * 不清的話，登出成功的回應會帶著一個續期後的秒數回去，而 §1.3 對 `expiresIn: null` 的語意
 * 收斂成一句話：**本次回應之後，客戶端手上沒有有效的 access token**——登出正是那三種情形之一。
 * 前端拿到一個非 null 的秒數，會把 deadline 往後推，然後在一個已經死掉的 session 上繼續倒數。
 */
export const endSession = (requestContext: RequestContext): void => {
  requestContext.session = null
}

/**
 * 交付一張新的 refresh 票給客戶端。
 *
 * 端點只說「交付這張票、有效這麼久」，**通道是入口層的事**（§1.5）：cookie 名稱與
 * `httpOnly`／`Secure`／`SameSite` 三個屬性都在 `refresh-ticket-transport.ts`。
 */
export const deliverRefreshTicket = (
  requestContext: RequestContext,
  ticket: string,
  maxAgeSeconds: number,
): void => {
  requestContext.refreshTicketDelivery = { kind: 'issue', ticket, maxAgeSeconds }
}

/**
 * 收回客戶端手上的 refresh 票（登出）。
 *
 * **這不是作廢**：作廢發生在資料庫（§5.4.7 的整條鏈），而且那才是有效力的一步。
 * 這裡只是順手把客戶端手上那份沒用的副本清掉，避免它在瀏覽器裡留到 30 天後。
 * 只做這一步而不作廢，等於「以為作廢了、其實沒有」——§5.4.5 說得很清楚，那比什麼都沒做更危險。
 */
export const withdrawRefreshTicket = (requestContext: RequestContext): void => {
  requestContext.refreshTicketDelivery = { kind: 'revoke' }
}
