/**
 * 身分驗證與授權的**注入介面**（ports）。
 *
 * 這裡只有型別，沒有實作。實作屬於 `modules/sessions/`、`modules/company-users/` 等業務模組，
 * 由組裝點（`app/`）把它們接到 http 的身分驗證 middleware 上。
 *
 * 為什麼是注入而不是讓 middleware 直接 import 模組：middleware 屬於入口層，模組屬於業務層。
 * 讓入口層直接相依某個模組的查詢函式，等於把「Web 前端這個入口怎麼驗身分」與「權限資料怎麼存」
 * 綁在一起——第二種入口出現時（§1.0.2），它要換掉的是驗證方式，不該連帶把權限查詢也複製一份。
 */

/** 通過 access token 驗證後可信的身分。**公司範圍只能來自這裡**，不得取自 request body（§4.2）。 */
export type VerifiedIdentity = {
  readonly sessionId: string
  readonly userId: string
  readonly companyId: string
  readonly companyUserId: string
}

/** 續期結果（§1.3）。兩個欄位必須一起重算，禁止只更新其中一個。 */
export type SessionRenewal = {
  /** 續期後的剩餘秒數，前端過期判斷的唯一依據。 */
  readonly expiresIn: number
  /** 續期後的絕對截止時刻，僅供 log 與除錯。 */
  readonly exp: string
}

/**
 * 驗證 access token。
 *
 * @returns 有效則回傳身分；**無效一律回傳 `null` 而不是拋例外**——token 過期是預期中的事，
 *   不是意外（§3.1.2）；拋例外會讓它與「真的出事了」在告警上長得一模一樣。
 */
export type AccessTokenVerifier = (accessToken: string) => Promise<VerifiedIdentity | null>

/**
 * 續期。
 *
 * 續期與後續處理結果**完全無關**：只要 token 在有效期內且驗證通過就續期，
 * 不管資料有沒有找到、業務規則過不過、有沒有權限做這個動作（§1.3）。
 */
export type SessionRenewer = (identity: VerifiedIdentity) => Promise<SessionRenewal>

/**
 * 查詢某位公司成員目前擁有的權限碼集合。
 *
 * @param companyId 公司範圍，來自已驗證的身分。
 * @param companyUserId 公司成員。
 * @returns 權限碼字串集合（`<大目錄>.<次目錄>.<動作>`）。回傳集合而不是「是否具備某碼」的判斷函式，
 *   是為了讓「碼怎麼算出來」只存在於一個地方（`path-code.ts`）——把比對搬進實作端，
 *   實作端就得自己知道規則，而那份知識一定會與路徑漂移。
 */
export type PermissionLookup = (companyId: string, companyUserId: string) => Promise<ReadonlySet<string>>

/** 身分驗證 middleware 的完整相依。由組裝點提供。 */
export type AccessControlPorts = {
  readonly verifyAccessToken: AccessTokenVerifier
  readonly renewSession: SessionRenewer
  readonly loadPermissionCodes: PermissionLookup
}

/**
 * refresh 票驗證的結果（§5.4.2）。
 *
 * **三種結果必須分開，不能收斂成「有效／無效」兩種**：`reuse-detected` 觸發的是
 * 「該成員的所有鏈全部作廢」這個**副作用**，而 `invalid`（票根本不存在、簽章不符、已過期）
 * 只是擋下這一次請求。合併之後，一張過期的票會把使用者所有裝置踢掉；
 * 而反過來合併成「一律只擋這一次」，偷用偵測就等於沒做——攻擊者可以安靜地用滿 30 天。
 *
 * 對前端而言三者的回應**完全相同**（401 ＋ `900`）：差別只在伺服器端做了什麼、log 記了什麼。
 * 讓呼叫端看得出差別會變成一個可探測的介面（§3.2）。
 *
 * **這一條講的是 HTTP 回應的形狀，不是這個內部型別。** `reuse-detected` 分支上的 `ticketId`
 * 只在伺服器端流動（`verifyRefreshTicket` → 憑證驗證器 → `revokeChainsOnReuse` → 稽核），
 * 從來不會被序列化進回應——三者對前端仍然完全相同。加這個欄位擴充的是「伺服器端記得住什麼」，
 * 不是「呼叫端看不看得出差別」，兩件事不衝突。
 */
export type RefreshTicketVerification =
  | {
      readonly outcome: 'valid'
      readonly identity: VerifiedIdentity
      /** 這一張票在資料上的識別；輪替時**即將被換掉的**就是它。 */
      readonly ticketId: string
    }
  | {
      readonly outcome: 'reuse-detected'
      /** 由**已作廢的那一列**解析出來的身分——全鏈作廢的範圍以它為準。 */
      readonly identity: VerifiedIdentity
      /**
       * 由**已作廢的那一列**解析出來的票 id——這次被第二次拿來用的就是它。
       *
       * **與 `valid.ticketId` 語意不同，不要混用**：那邊是「即將被輪替掉的票」，這裡是
       * 「被重用的票」。差別不是文字遊戲：作廢清單（`revokedTokenIds`）在「重用的是上一張票」
       * 與「重用的是三次輪替之前的票」兩種情況下完全相同——都是「這個成員目前所有活躍的票」，
       * 因為兩種情況的處置（全鏈作廢）本來就一樣。少了這一個欄位，事後翻稽核只看得到
       * 「作廢了哪幾張」，看不出「是哪一張舊票冒出來觸發的」，於是分不出前者（多半是網路重送，
       * 良性）與後者（票在外面躺了一段時間才出現，真正的資安事件）——而分不出來的結果是
       * 每一次都只能當良性處理。這是這筆稽核紀錄最有鑑識價值的一欄。
       */
      readonly ticketId: string
    }
  | { readonly outcome: 'invalid' }

/**
 * 驗證 refresh 票並**消耗它**（一次性使用，§5.4.2）。
 *
 * 「驗證」與「消耗」是同一件事，不拆成兩步：拆開之後，兩個併發請求會同時通過驗證、
 * 各自換到一張新票，於是同一條鏈出現兩張有效票——而「舊票已作廢」正是偷用偵測的前提。
 * 合併成一次條件式 UPDATE（§4.4），第二個請求會影響 0 列，當場被判為偷用。
 */
export type RefreshTicketVerifier = (rawTicket: string) => Promise<RefreshTicketVerification>

/**
 * 作廢某個身分的所有輪替鏈（偷用偵測的副作用，§5.4.2）。
 *
 * @param reusedTicketId 觸發這次全鏈作廢的那張票的 id（`RefreshTicketVerification` 的
 *   `reuse-detected.ticketId`）。一路傳到稽核紀錄裡，理由見該欄位的檔頭。
 */
export type SessionChainRevoker = (identity: VerifiedIdentity, reusedTicketId: string) => Promise<void>

/** refresh 群組的憑證驗證器（§1.9.1）的完整相依。由組裝點提供。 */
export type RefreshControlPorts = {
  readonly verifyRefreshTicket: RefreshTicketVerifier
  readonly revokeAllChainsOnReuse: SessionChainRevoker
}
