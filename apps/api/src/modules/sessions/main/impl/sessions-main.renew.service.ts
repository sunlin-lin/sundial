/**
 * 業務動作：算出續期後的 access token 壽命（§1.3 來源①）。
 *
 * **這個動作沒有對應的端點**，呼叫者是已登入群組的憑證驗證器。
 *
 * 為什麼它只有一行卻仍然是一個獨立的業務動作：`expiresIn`／`exp` 的唯一計算處是
 * 「access token 生命週期元件」（`domain/session-token.ts`），而 §1.3 要求續期與發證
 * **共用同一份實作**。讓驗證器直接自己算（或讓組裝點填一個常數）就是第二份實作，
 * 而兩份實作分岔的症狀是「登入回的秒數與續期回的秒數不一樣」——前端據此算出的 deadline 跟著錯，
 * 而回應在型別上完全合法、測試也不會紅。
 *
 * **實際的續期寫入（把 `access_expires_at` 往後推）發生在 `verifyAccessToken` 裡**，不在這裡：
 * 那一步與撤銷檢查必須看同一列、用同一個「現在」。本動作只負責把「續期後還有幾秒」講出來，
 * 而那個數字恆等於視窗長度——滑動視窗每次都推回完整長度，不是遞減值（§1.3）。
 */
import type { SessionRenewal } from '../../../../shared/access-control.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { computeSessionLifetime } from '../domain/session-token.ts'

/**
 * 刻意**不收 `identity` 參數**，即使 `SessionRenewer` 這個 port 的簽章有它。
 *
 * 續期的長度與「你是誰」無關（每個人的視窗一樣長），收了一個不會用到的參數，
 * 下一個人只會問「那是不是應該依身分算不同的長度」——而那個問題不該存在。
 * 由組裝點把 port 的參數丟掉，那一行是看得見的。
 */
export const renewSession = (context: SessionsMainContext): SessionRenewal =>
  computeSessionLifetime(context.clock, context.session.accessTokenTtlSeconds)
