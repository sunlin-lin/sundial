/**
 * `refresh_tokens`：refresh token 的伺服器端存放處，同時是**整個 session 的權威狀態**（§5.4）。
 *
 * **這張表不只是「票的清單」，它是 §5.4 五條規則唯一的落點**，每一欄都對應其中一條，
 * 少一欄就有一條規則變成寫不出來（不是「比較難寫」，是資料上推不出來）：
 *
 * | 規則 | 落在哪一欄 |
 * |---|---|
 * | §5.4.2 一次性輪替 | `active_session_id`／`revoked_at`：換票時把舊的那一列標成已作廢 |
 * | §5.4.2 偷用偵測 | 同上：**已作廢的列仍然留著**，舊票再次出現時查得到它、也看得出它已作廢 |
 * | §5.4.7 整條鏈作廢 | `session_id`：一次登入＝一條輪替鏈，鏈中每一列共用同一個值 |
 * | §5.4.2 登出所有裝置 | `company_user_id`：以成員為範圍作廢所有鏈 |
 * | §5.4.6 access token 即時撤銷 | `access_expires_at` ＋「這條鏈還有沒有有效的列」：憑證驗證器每個請求查一次 |
 *
 * **為什麼 access token 的狀態也放在這張表**：§5.4.1 要求 access token 是**滑動視窗**
 * （每次通過驗證即續期）而且**可即時撤銷**。兩者都不可能由「自帶簽章、自帶到期時間」的票達成
 * ——滑動需要一個伺服器端可以往後推的截止時刻（envelope 沒有任何欄位可以把新票帶回前端，§1.3），
 * 即時撤銷需要每個請求查一次伺服器端狀態。因此 access token 的權威狀態就是這裡的
 * `access_expires_at`，票本身只是一張帶簽章的「我是誰」聲明，**不帶自己的到期時間**。
 *
 * 一條鏈在任一時刻**至多有一列有效**（由 `uq_refresh_tokens_active_session` 保證），
 * 那一列就是這個 session 的當前狀態。
 */
import { Buffer } from 'node:buffer'
import { char, customType, datetime, foreignKey, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { companyUsers } from './company-users.ts'

/**
 * 固定長度的二進位欄位。
 *
 * **不能用 drizzle 內建的 `binary()`**：它的 TypeScript 型別是 `string`，而
 * `mapFromDriverValue` 對驅動回傳的 Buffer 做 `value.toString()`（UTF-8 解碼）——
 * SHA-256 的位元組不是合法的 UTF-8，這一步會把不合法序列靜靜換成 U+FFFD，
 * 於是寫進去的 hash 與讀回來的位元組不同，**比對永遠不會相等**，而且不會有任何錯誤訊息。
 * （與 `employees.ts` 的 `fixedBytes` 是同一個理由、同一個寫法。）
 */
const fixedBytes = customType<{
  data: Buffer
  driverData: Buffer
  config: { length: number }
  configRequired: true
}>({
  dataType: (config) => `binary(${config.length})`,
})

/** SHA-256 的位元組長度。`token_hash` 的寬度由它決定，不寫死 32。 */
export const TOKEN_HASH_BYTE_LENGTH = 32

/**
 * 作廢原因。**不用 DB ENUM**（通用規範 §1.4），代碼值的唯一來源是這個 const object。
 *
 * 四種原因必須分得出來，因為它們在事後追查時的意義完全不同：`Rotated` 是每天都會發生的正常輪替，
 * `ReuseDetected` 是**唯一一種系統自己偵測到的安全事件**（§5.4.2 要求寫稽核與告警）。
 * 把兩者混成一個「已作廢」旗標，等於把那個訊號丟掉——而它正是本系統偵測「票被偷」的唯一防線。
 */
export const RefreshTokenRevokeReason = {
  /** §5.4.2 的一次性輪替：這張票被拿去換了新票。 */
  Rotated: 'ROTATED',
  /** §5.4.7：使用者登出，整條鏈作廢。 */
  Logout: 'LOGOUT',
  /** 登出所有裝置：該成員的所有鏈作廢。 */
  LogoutAll: 'LOGOUT_ALL',
  /** §5.4.2 偷用偵測：已作廢的票再次被使用，視為外洩，該成員的所有鏈作廢。 */
  ReuseDetected: 'REUSE_DETECTED',
} as const

export type RefreshTokenRevokeReasonValue = (typeof RefreshTokenRevokeReason)[keyof typeof RefreshTokenRevokeReason]

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    /** 這一張票。輪替鏈中的一環，每換一次票就多一列。 */
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * 公司範圍（§4.2）。
     *
     * 沒有它的話，refresh 端點就是一支**不帶公司條件**的查詢——而它是所有端點裡最不該如此的一支：
     * 它換出來的 access token 會把 `companyId` 寫進 claims，錯一次就等於發出一張進錯公司的票。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    /**
     * **一次登入**（§5.4.7）。一條輪替鏈共用同一個值，輪替時原樣沿用。
     *
     * 沒有這一欄，「整條鏈」在資料上是**推不出來的**——只能靠「前一張是誰」逐張回溯，
     * 而回溯要嘛在輪替時把舊列刪掉就斷了，要嘛就得保留全部歷史再走一遍鏈。
     * 有了它，「登出這台裝置」（作廢這一條鏈）與「登出所有裝置」（作廢所有鏈）
     * 變成同一種操作的兩個範圍，而不是兩段各自寫錯的邏輯。
     *
     * 它同時是 access token 的 claims 裡那個 `sessionId`：驗證器拿 claims 的 `sessionId`
     * 回到這張表查「這條鏈還有沒有未作廢的列」，這就是 §5.4.6 的即時撤銷檢查。
     */
    sessionId: char('session_id', { length: 36 }).notNull(),
    /**
     * 全域帳號。**不是**作廢範圍的依據（那是 `company_user_id`），只用來建立已驗證身分
     * （`VerifiedIdentity.userId`）與事後追查。
     *
     * 刻意**不建 FK → `users.id`**：那條 FK 會讓 InnoDB 自動長出一個只有 `(user_id)` 的索引，
     * 而 §4.5 要求本表的索引一律以 `company_id` 開頭。自動長出來的索引還有一個更麻煩的性質
     * ——它是隱形的，review 看不見。本欄的正確性由下方指向 `company_users(company_id, id)`
     * 的複合外鍵間接保證（那一列自己的 `user_id` 才是權威），因此不需要第二條外鍵查同一件事。
     */
    userId: char('user_id', { length: 36 }).notNull(),
    /**
     * 公司成員。**作廢範圍以它為單位**（「登出所有裝置」＝作廢這個成員的所有鏈）。
     *
     * 為什麼是成員而不是全域帳號：本表是帶 `company_id` 的表，以全域帳號為範圍的作廢
     * 會是一次**不帶公司條件的寫入**，而那是 §4.2 明文禁止、且優先度最高的一條規則。
     * 同一個帳號在別家公司的 session 屬於別家公司的範圍（見交付回報的規範問題）。
     */
    companyUserId: char('company_user_id', { length: 36 }).notNull(),
    /**
     * refresh token 原值的 SHA-256。**DB 存 hash 不存原值**（§5.4.3 的精神與 §5.1 一致）。
     *
     * 為什麼即使票已經帶簽章仍要存 hash：簽章證明「這串字是我們發的」，hash 證明
     * 「這串字就是我們發給**這一列**的那一串」。少了 hash，簽章金鑰一旦外洩，
     * 攻擊者可以自己簽一張指向任何 `id` 的票；有了 hash，他還得猜中那一列的原值。
     */
    tokenHash: fixedBytes('token_hash', { length: TOKEN_HASH_BYTE_LENGTH }).notNull(),
    /** 這張票發出的時刻。台北牆鐘時間，不做任何換算（§6）。 */
    issuedAt: datetime('issued_at', { mode: 'string' }).notNull(),
    /**
     * **這條鏈**的絕對截止時刻（§5.4.1 的 30 天）。輪替時**原樣沿用**，不重新計算。
     *
     * 沿用而不是每次輪替都重新給 30 天：後者會讓 30 天這個數字永遠不會到期
     * ——只要使用者持續使用，鏈就無限延長，而「refresh token 壽命 30 天」就變成一句沒有效力的話。
     * 沿用之後它的意義是明確的：**一次登入最長 30 天**，到期就重新登入。
     */
    expiresAt: datetime('expires_at', { mode: 'string' }).notNull(),
    /**
     * access token 的滑動視窗截止時刻（§5.4.1 的 2 小時）。
     *
     * 每一個通過憑證驗證的請求都會把它往後推（§1.3 的續期），因此「使用者只要還在操作就不會被登出」
     * 這件事在資料上就是這一欄一直在變大。**它是 access token 是否過期的唯一權威**
     * ——票本身不帶到期時間，理由見檔頭。
     */
    accessExpiresAt: datetime('access_expires_at', { mode: 'string' }).notNull(),
    /**
     * **「這一列是這條鏈當前有效的那一張票」的標記**：有效時等於 `session_id`，作廢時寫成 `NULL`。
     *
     * 這一欄看起來是 `session_id` 的重複，所以理由必須寫清楚——它是
     * 「**一條鏈同時只能有一列有效**」這條約束唯一寫得出來的形式（見下方唯一鍵）。
     *
     * **為什麼不照 §4.3 的 `revoked_seq NOT NULL DEFAULT 0` 慣例**（本專案其他表都那樣寫）：
     * 那個慣例解的是**另一個形狀**的問題。§4.3 的情境是「代碼在未刪除的資料中唯一」——
     * 那裡的 `NULL` 出現在**有效**列上，而 UNIQUE 索引中 `NULL` 互不相等，
     * 於是有效列彼此不衝突，約束等於沒設，所以必須把 `NULL` 換成 `0`。
     *
     * 這裡要的東西**剛好相反**：作廢的列必須**彼此不衝突**（一條鏈會累積很多張作廢的票），
     * 而有效的列必須衝突（同一條鏈不得有兩張）。`NULL` 互不相等這個性質在這裡正是我們要的。
     * 反過來套 `revoked_seq` 的話，唯一鍵會是 `(company_id, session_id, revoked_seq)`，
     * 而**同一條鏈裡每一張作廢的票都必須有不同的 `revoked_seq`**——時間戳做不到這件事：
     * 同一次登出可以在同一毫秒作廢多張票，而測試用的固定時鐘更是每次都給同一個值。
     * 這不是理論風險，它在本模組的第一次測試就發生了。
     */
    activeSessionId: char('active_session_id', { length: 36 }),
    /** 作廢時刻；NULL 代表這張票仍然有效。與 {@link activeSessionId} 同時寫入。 */
    revokedAt: datetime('revoked_at', { mode: 'string' }),
    /** 作廢原因，見 {@link RefreshTokenRevokeReason}。與 `revoked_at` 同時寫入。 */
    revokedReason: varchar('revoked_reason', { length: 32 }).$type<RefreshTokenRevokeReasonValue>(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 同一張票的原值不可能對應兩列。以 `company_id` 開頭（§4.5），
     * 同時也是「拿票換身分」那支查詢的支撐索引。
     */
    uniqueIndex('uq_refresh_tokens_company_token').on(table.companyId, table.tokenHash),
    /**
     * **一條鏈同時只能有一列有效**。作廢的列 `active_session_id` 是 `NULL`，
     * 而 UNIQUE 索引中 `NULL` 互不相等——因此一條鏈可以累積任意多張作廢的票（偷用偵測需要它們），
     * 卻不可能同時有兩張有效票（輪替最不能出錯的地方：兩張有效票並存時，
     * 「舊票已作廢」這個偷用偵測的前提就沒了）。
     *
     * 這條唯一鍵同時是憑證驗證器那支查詢（`company_id` ＋ `active_session_id`）的**支撐索引**，
     * 而那是**每一個已登入請求都會跑一次**的查詢——沒有索引就是每個請求一次全表掃描。
     */
    uniqueIndex('uq_refresh_tokens_active_session').on(table.companyId, table.activeSessionId),
    /**
     * 「登出所有裝置」與偷用偵測的全鏈作廢：以成員為範圍一次更新。
     * 以 `company_id` 開頭（§4.5），且前兩段正好是下面那條複合外鍵需要的索引
     * ——明確建出來，InnoDB 就不會自動補一個看不見的。
     */
    index('ix_refresh_tokens_company_member').on(table.companyId, table.companyUserId, table.activeSessionId),
    /**
     * 複合外鍵，**帶上 `company_id`**（比照 `company_user_roles` 的四條外鍵）。
     *
     * 只指向 `company_users.id` 的話，一列「A 公司的 session」可以指向 B 公司的成員，
     * 資料庫完全接受；而這張表決定的是「誰能拿到哪一家公司的 access token」，
     * 寫錯一列就是一張進錯公司的票。指向 `(company_id, id)` 之後，那種列在資料庫層就寫不出來。
     * 這也讓本表的 `company_id` 間接受到約束（`company_users.company_id` 有 FK 指向 `companies.id`），
     * 因此不需要再單獨拉一條 FK 到 `companies`。
     */
    foreignKey({
      name: 'fk_refresh_tokens_company_user',
      columns: [table.companyId, table.companyUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
  ],
)
