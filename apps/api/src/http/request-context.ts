/**
 * 每次請求各自持有的可變狀態。
 *
 * 三格東西，三對上下游，共同點是「寫的人與讀的人是兩個不同的 plugin」：
 *
 * | 欄位 | 誰寫 | 誰讀 |
 * |---|---|---|
 * | `session` | 已登入群組的憑證驗證器（續期，§1.3 來源①）／發證端點（§1.3 來源②） | 出口層填 `expiresIn`／`exp`；端點取已驗證身分 |
 * | `verifiedRefreshTicket` | refresh 群組的憑證驗證器 | `/sessions/main/refresh` 的 handler |
 * | `refreshTicketDelivery` | 發證／登出端點 | refresh 票的傳輸層（把它翻成 cookie） |
 *
 * **`session` 刻意只有一格**：§1.3 規定續期與發證兩個來源共用同一份實作、寫進**同一格**請求上下文。
 * 分成兩格就得有一段「誰贏」的仲裁邏輯，而那段邏輯寫錯的表現是「某些端點回的秒數比實際壽命長或短」
 * ——前端據此算出的 deadline 跟著錯，而回應在型別上完全合法、測試也不會紅。
 * 同一次請求不會同時發生兩者（登入在公開群組沒有票可續；refresh 群組不續期而是發證），
 * 因此一格就夠，也就沒有優先序要記。
 *
 * **刻意不用 Elysia 的 `store`**：`store` 是整個 app 共用的，不是每次請求一份——把 session 放進去
 * 會讓併發的兩個請求互相覆蓋彼此的身分，而症狀是「偶爾回到別人的 session 剩餘秒數」這種
 * 無法重現、也不會有任何錯誤的行為。`derive` 每次請求建立一個新物件，沒有這個失敗模式。
 */
import { Elysia } from 'elysia'
import type { SessionRenewal, VerifiedIdentity } from '../shared/access-control.ts'

export type RequestSession = {
  readonly identity: VerifiedIdentity
  readonly renewal: SessionRenewal
}

/** refresh 群組的憑證驗證器驗過、並且已經消耗掉的那一張票。 */
export type VerifiedRefreshTicket = {
  readonly identity: VerifiedIdentity
  /** 這一張票在資料上的識別。輪替時新票沿用同一條鏈（`identity.sessionId`）。 */
  readonly ticketId: string
}

/**
 * 端點要求入口層對 refresh 票的**傳輸通道**做的事。
 *
 * 為什麼是「指令」而不是讓端點自己寫 cookie：憑證的通道由**認證群組**規定，不是端點的契約
 *（§1.5）。端點知道的是「這次登入發了一張新票／這次登出把票收回」，
 * 「票放在哪個 cookie、帶哪些屬性」則是入口層的知識——改 cookie 名稱或屬性時，
 * 要改的地方只有傳輸層一處，不必回頭找哪幾支端點自己寫過 `Set-Cookie`。
 */
export type RefreshTicketDelivery =
  { readonly kind: 'issue'; readonly ticket: string; readonly maxAgeSeconds: number } | { readonly kind: 'revoke' }

export type RequestContext = {
  /** `null` 代表本次請求未經 Session 授權（公開端點、身分驗證未通過，或登出成功後）。 */
  session: RequestSession | null
  /** `null` 代表本次請求不在 refresh 群組內，或該群組的驗證未通過。 */
  verifiedRefreshTicket: VerifiedRefreshTicket | null
  /** `null` 代表本次回應不需要動 refresh 票的傳輸通道。 */
  refreshTicketDelivery: RefreshTicketDelivery | null
}

export const requestContext = new Elysia({ name: 'request-context' }).derive(
  { as: 'global' },
  (): { requestContext: RequestContext } => ({
    requestContext: { session: null, verifiedRefreshTicket: null, refreshTicketDelivery: null },
  }),
)
