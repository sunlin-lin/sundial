/**
 * 本模組跨層傳遞的型別（純型別，零執行期程式碼）。
 *
 * 這些**不是** HTTP 的形狀，也不是資料庫的列（§1.8.0 的三種形狀不可混用）：
 * 端點的 `data` 由 handler 以明確的映射函式收窄，資料庫的列由 repository 收成這裡的型別。
 * 兩端共用同一個型別的話，資料表加一個欄位就自動出現在 API 上，而且沒有任何一行程式碼會改變。
 */
import type { RefreshTokenRevokeReasonValue } from '../../../../db/schema/index.ts'
import type { SessionRenewal, VerifiedIdentity } from '../../../../shared/access-control.ts'

/** 登入端點收到的輸入。三者都是**業務參數**（§1.5）：使用者提交、待伺服器驗證的材料。 */
export type LoginInput = {
  /**
   * 公司代號。**不是 `companyId`**（§4.2）：它是使用者鍵入、待驗證的字串，
   * 經「公司代號 ＋ 帳號 ＋ 密碼」三者一起驗證後才會被接受，而公司範圍仍由伺服器從解析結果推導。
   * 把它當成 `companyId` 的替身直接接進 `WHERE`，等於把公司隔離整組繞掉。
   */
  readonly companyCode: string
  readonly username: string
  /** 明碼。**只往下傳給密碼驗證，不進 log、不進錯誤訊息、不進任何回傳值**（§5.1）。 */
  readonly password: string
}

/**
 * 身分解析查詢的結果（§4.2 的排除適用範圍）。
 *
 * **欄位刻意只有這四個**：三個識別 ＋ 一個密碼 hash，沒有任何業務欄位。
 * §4.2 的三項邊界中第 3 項最關鍵——只要這支查詢能回傳業務欄位，它就是一個**不帶公司條件的
 * 萬用查詢**，而它被放在認證模組裡，離所有「跨公司洩漏」的測試都很遠。
 *
 * 密碼 hash 之所以在列上：它是**驗證身分所需的材料**，不是業務資料。少了它，
 * 「以公司代號 ＋ 帳號為單一查詢條件解析出身分，查不到就走與密碼錯誤同一條失敗路徑」
 *（§3.2 明文指定的正確作法）就寫不出來——只能先查一次帳號、再查一次密碼，而那正是分段驗證。
 */
export type ResolvedLoginIdentity = {
  readonly companyId: string
  readonly userId: string
  readonly companyUserId: string
  readonly passwordHash: string
}

/** 登入成功後才查的顯示用資料。這一支是**帶公司條件**的普通業務查詢，與身分解析查詢分開。 */
export type SessionProfile = {
  readonly displayName: string
  readonly companyCode: string
  readonly companyName: string
}

/** 一張新發出的票組。 */
export type IssuedTokens = {
  readonly accessToken: string
  readonly refreshTicket: string
  /** 這張 refresh 票在客戶端可以留多久（秒）。 */
  readonly refreshMaxAgeSeconds: number
}

/**
 * 這張新票的完整壽命，由 access token 生命週期元件算出（§1.3 來源②）。
 *
 * **業務結果帶著它，不是「業務層碰了 envelope」**（§1.8.2 的禁令一字不改）：這兩個數字描述的是
 * 「剛剛發出去的那張票能用多久」，那是發證這個業務動作的產出，與 HTTP 無關——
 * 另一種入口（排程、CLI）簽出一張票時同樣需要知道它多久到期。
 * 把它寫進 envelope 的仍然只有出口層，而 handler 只是把這個值搬進請求上下文（§1.3）。
 *
 * 型別直接沿用 `SessionRenewal`：續期與發證共用同一份實作，結果自然是同一個型別。
 * 另外定義一個一模一樣的型別，只會讓「這兩個是不是同一件事」變成一個要查的問題。
 */
export type IssuedLifetime = SessionRenewal

/** 登入成功的業務結果。**不含 envelope 的任何欄位**（§1.8.2）。 */
export type LoginOutcome = {
  readonly identity: VerifiedIdentity
  readonly tokens: IssuedTokens
  readonly lifetime: IssuedLifetime
  readonly profile: SessionProfile
}

/** 換票成功的業務結果。 */
export type RefreshOutcome = {
  readonly identity: VerifiedIdentity
  readonly tokens: IssuedTokens
  readonly lifetime: IssuedLifetime
}

/**
 * 登出／登出所有裝置的業務結果。
 *
 * 刻意帶回作廢了幾條票，而不是回一個空物件：這個數字**不對外**（端點的 `data` 是 `{ ok: true }`），
 * 但它是「這次登出到底有沒有作廢到東西」唯一的證據，測試與日後的稽核都靠它。
 */
export type RevocationOutcome = {
  readonly revokedCount: number
}

/**
 * 一次作廢要寫進去的欄位。
 *
 * 兩者**必須一起寫**，所以收成一個型別而不是兩個參數。實際寫入時還會把 `active_session_id`
 * 清成 `NULL`（那一步在 repository 內，因為它是資料表的約束機制而不是業務決定）——
 * 少了那一步，`revoked_at` 有值但那一列在唯一鍵的眼中仍然是「這條鏈的有效票」，
 * 於是下一次輪替會撞唯一鍵，而登出「看起來成功了」。
 */
export type TicketRevocation = {
  /** 作廢時刻，台北牆鐘（§6.2 由注入的 clock 取得）。 */
  readonly at: string
  /**
   * 作廢原因。**收窄成聯集字面值而不是 `string`**（§2：固定代碼欄位必須用聯集字面值）：
   * 寫成 `string` 之後，打錯一個字（`'LOGOOUT'`）照樣寫得進資料庫，
   * 而事後翻資料庫想找出「有多少次偷用偵測」時，那幾筆就永遠對不上任何條件。
   */
  readonly reason: RefreshTokenRevokeReasonValue
}

/** 已消耗的 refresh 票（由 refresh 群組的憑證驗證器交給端點）。 */
export type ConsumedRefreshTicket = {
  readonly identity: VerifiedIdentity
  readonly ticketId: string
}
