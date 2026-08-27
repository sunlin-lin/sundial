/**
 * 發證：把「這是誰」變成一組新的票（§1.3 來源②）。零 IO 純函式。
 *
 * **登入與換票共用這一支**，這是刻意的：兩者發出來的票必須**完全同構**——同樣的 claims、
 * 同樣的壽命算法、同樣的 hash。各寫一份的話，兩份會慢慢分岔（一邊補了欄位、一邊沒有），
 * 而分岔的症狀是「用登入拿到的票可以，用換票拿到的票某些端點會 401」，
 * 且兩張票在型別上完全合法、測試也不會紅。
 *
 * 本檔只負責「算出要發什麼」，**寫進資料庫是 service 的事**：純函式才測得動
 * ——「同一組輸入永遠簽出同一串字」「壽命等於設定值」這兩件事不需要資料庫就驗得完。
 */
import type { Buffer } from 'node:buffer'
import type { SessionRenewal, VerifiedIdentity } from '../../../../shared/access-control.ts'
import type { Clock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'
import type { IssuedTokens } from './session-model.ts'
import {
  computeSessionLifetime,
  hashTicket,
  signAccessToken,
  signRefreshTicket,
  toAccessTokenClaims,
  toRefreshTicketClaims,
} from './session-token.ts'

const SECONDS_PER_DAY = 24 * 60 * 60

/**
 * 本次發證要用到的三個識別碼。
 *
 * **由呼叫端產生而不是在這裡 `crypto.randomUUID()`**：本檔是純函式，隨機值一進來就不再是純的，
 * 而「同一組輸入永遠簽出同一串字」正是這一層唯一測得動的性質。
 */
export type SessionIdentifiers = {
  /** 一次登入（§5.4.7）。**換票時沿用舊值**，登入時才產生新的——這一行就是「同一條鏈」的定義。 */
  readonly sessionId: string
  /** 新的 refresh 票在 `refresh_tokens` 的主鍵。 */
  readonly ticketId: string
  /** 新的 access token 的識別；只為了讓同一秒內簽出的兩張票不是同一串字（見 session-token.ts）。 */
  readonly accessTokenId: string
}

/** 發證的對象。三個欄位都來自伺服器端已經確立的事實，不是客戶端送來的值（§4.2）。 */
export type SessionSubject = {
  /** **不得為 `null`**（§4.2）：一張沒有公司的票實質上是一張繞過公司隔離檢查的票。 */
  readonly companyId: string
  readonly userId: string
  readonly companyUserId: string
}

export type MintedSession = {
  readonly identity: VerifiedIdentity
  readonly tokens: IssuedTokens
  /** 要寫進 `refresh_tokens.token_hash` 的值。**原值只存在於回傳的票裡，不進資料庫**（§5.4.3）。 */
  readonly ticketHash: Buffer
  /** 台北牆鐘的簽發時刻。 */
  readonly issuedAt: string
  /** access token 的滑動視窗截止（簽發時刻 ＋ 視窗長度）。 */
  readonly accessExpiresAt: string
  /**
   * 這張新票的**完整壽命**（§1.3 來源②）。
   *
   * 由 {@link computeSessionLifetime} 算出來——與續期**同一份實作**，因此登入、換票與
   * 每一次續期回給前端的秒數永遠是同一個公式算出來的。
   */
  readonly lifetime: SessionRenewal
}

export const mintSession = (input: {
  readonly config: SessionConfig
  readonly clock: Clock
  readonly ids: SessionIdentifiers
  readonly subject: SessionSubject
}): MintedSession => {
  const { config, clock, ids, subject } = input
  const issuedAt = clock.now()

  const accessToken = signAccessToken(
    config.accessTokenSecret,
    toAccessTokenClaims({
      tokenId: ids.accessTokenId,
      sessionId: ids.sessionId,
      companyId: subject.companyId,
      userId: subject.userId,
      companyUserId: subject.companyUserId,
      issuedAt,
    }),
  )

  const refreshTicket = signRefreshTicket(
    config.accessTokenSecret,
    // 兩張票用同一把金鑰簽，靠 payload 裡的 `kind` 區分（見 session-token.ts）。
    // 兩把金鑰看起來更嚴，但它多的是一個「哪一把金鑰輪替到哪裡」的狀態要維護，
    // 而混用的風險已經由 `kind` 擋掉了——那是一個驗證步驟，不是一條要記得遵守的規則。
    toRefreshTicketClaims({ ticketId: ids.ticketId, companyId: subject.companyId, issuedAt }),
  )

  return {
    identity: {
      sessionId: ids.sessionId,
      userId: subject.userId,
      companyId: subject.companyId,
      companyUserId: subject.companyUserId,
    },
    tokens: {
      accessToken,
      refreshTicket,
      // cookie 的 `Max-Age` 一律給完整壽命，即使這條鏈的伺服器端截止時刻可能更早
      //（換票沿用原本的 30 天，見 schema）。cookie 只是客戶端的方便，**票有沒有效由伺服器決定**：
      // 讓瀏覽器早一點丟掉票並不會更安全（伺服器照樣會拒絕），但算錯這個數字會讓票提早消失，
      // 而症狀是「用到一半突然要重新登入」。
      refreshMaxAgeSeconds: config.refreshTokenTtlDays * SECONDS_PER_DAY,
    },
    ticketHash: hashTicket(refreshTicket),
    issuedAt,
    accessExpiresAt: clock.after(config.accessTokenTtlSeconds),
    lifetime: computeSessionLifetime(clock, config.accessTokenTtlSeconds),
  }
}

/** 一條新的輪替鏈的絕對截止時刻（§5.4.1 的 30 天）。**只有登入會呼叫它**，換票一律沿用舊值。 */
export const chainExpiresAt = (clock: Clock, config: SessionConfig): string =>
  clock.after(config.refreshTokenTtlDays * SECONDS_PER_DAY)
