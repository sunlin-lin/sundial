/**
 * access token 生命週期元件 ＋ 兩張票的簽章（§1.3、§5.4.1）。零 IO 純函式。
 *
 * **這個檔案就是 §1.3 說的「發證元件」與「生命週期元件」**，兩者放在一起是因為它們算的是同一件事的
 * 兩面：發一張票的時候要同時算出它的壽命，而續期的時候要用**同一份實作**算出續期後的壽命
 *（§1.3：「不得有第二份實作，也不得由呼叫者自行帶入秒數」）。兩份實作的後果是可預測的——
 * 登入回的秒數與續期回的秒數用不同的公式算，而回應在型別上完全合法、測試也不會紅。
 *
 * 它落在 `domain/` 而不是 `shared/`，正是 §8 第 21 條「發證能力的介面只能被認證模組 import」的
 * 執行手段：`domain/` 依 §0.3 只有本大目錄碰得到，因此**任何其他模組都不可能替自己簽一張票**
 * ——這不是一條要記得遵守的規則，是一個 import 不到的事實。
 *
 * **access token 刻意不帶自己的到期時間。** 這一點看起來像疏漏，所以理由寫在這裡：
 * §5.4.1 要求 access token 是滑動視窗（每次通過驗證即續期）**且**可即時撤銷（§5.4.6），
 * 而 envelope 沒有任何欄位可以把「新的票」帶回前端（§1.3 只有 `expiresIn` 這個數字）。
 * 也就是說「續期」不可能是「換一張新票」，只可能是「把伺服器端的截止時刻往後推」。
 * 因此票本身只是一張帶簽章的「我是誰」聲明，是否過期一律由 `refresh_tokens.access_expires_at` 決定。
 * 把到期時間簽進票裡的話，滑動視窗最多只能滑到票自己的到期時刻為止，
 * 而症狀是「連續操作滿兩小時的人會突然被登出」——他明明一直在用。
 */
import { Buffer } from 'node:buffer'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { SessionRenewal } from '../../../../shared/access-control.ts'
import type { Clock } from '../../../../shared/clock.ts'

/**
 * 票的種類，簽進 payload 裡。
 *
 * **這一欄是 §5.4.1「refresh token 只認一個端點」的執行手段**：沒有它的話，兩張票都是
 * 「同一把金鑰簽出來的字串」，把 refresh 票放進 `Authorization: Bearer` 送出去會**通過** access token
 * 的驗證，於是它就只是一張 30 天壽命的 access token，兩張票的設計當場失效。
 * 有了它，混用在簽章驗證的下一步就被擋下，而且不需要任何額外的檢查邏輯。
 */
const TokenKind = {
  Access: 'access',
  Refresh: 'refresh',
} as const

/**
 * access token 的 claims。
 *
 * `companyId` **必填且不可為 `null`**（§4.2）：一張沒有公司的票實質上是一張繞過公司隔離檢查的票
 * ——所有 `WHERE company_id = ?` 會拿到 `null`，查詢要嘛回空、要嘛條件被整個省略，
 * 而它在型別上完全合法。這裡把它宣告成必填的 `string`，就是那條規則的型別檢查形式。
 */
export type AccessTokenClaims = {
  readonly kind: typeof TokenKind.Access
  /**
   * 這一張票自己的識別。
   *
   * 不參與任何驗證，存在的唯一理由是**讓同一秒內為同一個 session 簽出的兩張票不是同一串字**
   *（`issuedAt` 只到秒）。少了它，輪替測試裡「新票與舊票不同」這件事會時真時假。
   */
  readonly tokenId: string
  /** 一次登入（§5.4.7）。驗證器拿它回 `refresh_tokens` 查這條鏈還活著沒有。 */
  readonly sessionId: string
  readonly companyId: string
  readonly userId: string
  readonly companyUserId: string
  /** 簽發時刻，台北牆鐘。**只供 log 與追查**，不是過期判斷的依據（依據見檔頭）。 */
  readonly issuedAt: string
}

/**
 * refresh 票的 claims。
 *
 * **刻意只帶 `ticketId` 與 `companyId`，不帶 `userId`／`companyUserId`／`sessionId`。**
 * 身分一律由資料庫那一列解析出來——票上多寫一份，就會有人拿票上的值去做事，
 * 而那一份不會隨著資料庫的作廢狀態改變。`companyId` 是唯一的例外，因為它必須在查詢**之前**
 * 就存在：§4.2 要求每一次查詢都帶公司條件，而這一支查詢的公司條件只能來自票本身
 *（它經過簽章，屬於「伺服器簽發、代表身分已成立」那一類，不是客戶端說了算的值）。
 */
export type RefreshTicketClaims = {
  readonly kind: typeof TokenKind.Refresh
  /** 這一張票在 `refresh_tokens` 的主鍵。 */
  readonly ticketId: string
  readonly companyId: string
  readonly issuedAt: string
}

const SEGMENT_SEPARATOR = '.'
const SEGMENT_COUNT = 2

const toBase64Url = (value: Buffer): string => value.toString('base64url')

const signature = (secret: string, payload: string): string =>
  toBase64Url(createHmac('sha256', secret).update(payload).digest())

/**
 * 比對兩段簽章。
 *
 * **必須是定時比較**：`===` 會在第一個不同的位元組就回傳，於是「猜對前幾個字元」比「全錯」慢一點點，
 * 而那個時間差可以被統計出來，等於把簽章一個位元組一個位元組地猜出來。
 * 長度不同時直接回 false——`timingSafeEqual` 對長度不同的 Buffer 會拋例外。
 */
const signatureMatches = (expected: string, actual: string): boolean => {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const actualBytes = Buffer.from(actual, 'utf8')
  if (expectedBytes.length !== actualBytes.length) return false
  return timingSafeEqual(expectedBytes, actualBytes)
}

/** 把 claims 簽成一串 `<payload>.<簽章>`。 */
const sign = (secret: string, claims: AccessTokenClaims | RefreshTicketClaims): string => {
  const payload = toBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${payload}${SEGMENT_SEPARATOR}${signature(secret, payload)}`
}

/**
 * 驗簽並取回 payload 的原始 JSON。
 *
 * @returns 形狀不對或簽章不符時一律 `null`。**不拋例外**：拿到一張壞票是預期中的事
 *   （過期、被竄改、根本不是我們發的），不是意外（§3.1.2）；拋例外會讓它與「真的出事了」
 *   在告警上長得一模一樣。
 */
const readVerifiedPayload = (secret: string, token: string): unknown => {
  const segments = token.split(SEGMENT_SEPARATOR)
  if (segments.length !== SEGMENT_COUNT) return null
  const [payload, provided] = segments
  if (payload === undefined || provided === undefined || payload === '') return null
  if (!signatureMatches(signature(secret, payload), provided)) return null

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return decoded
  } catch {
    // 簽章對得上卻不是合法 JSON，只可能是我們自己簽壞了或 payload 被截斷。
    // 對呼叫端而言結果與「票是假的」相同——回 null，讓它走同一條 `900` 路徑。
    return null
  }
}

/** 逐欄檢查而不是型別斷言：payload 來自 HTTP 邊界外，形狀沒有任何靜態保證（禁止用 `as` 硬轉）。 */
const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? { ...value } : null

/** 簽發一張 access token。 */
export const signAccessToken = (secret: string, claims: AccessTokenClaims): string => sign(secret, claims)

/** 簽發一張 refresh 票。 */
export const signRefreshTicket = (secret: string, claims: RefreshTicketClaims): string => sign(secret, claims)

/**
 * 驗證 access token 的簽章與形狀。
 *
 * **通過這一關不代表這張票還有效**：是否被撤銷、是否過了滑動視窗，一律由資料庫那一列決定
 *（§5.4.6：驗證器每個請求都必須檢查該 session 的撤銷狀態，不做跨請求快取）。
 * 這裡只回答「這串字是不是我們發的、上面寫著誰」。
 */
export const verifyAccessTokenSignature = (secret: string, token: string): AccessTokenClaims | null => {
  const record = asRecord(readVerifiedPayload(secret, token))
  if (record === null) return null
  if (record['kind'] !== TokenKind.Access) return null

  const tokenId = readString(record, 'tokenId')
  const sessionId = readString(record, 'sessionId')
  const companyId = readString(record, 'companyId')
  const userId = readString(record, 'userId')
  const companyUserId = readString(record, 'companyUserId')
  const issuedAt = readString(record, 'issuedAt')
  if (
    tokenId === null ||
    sessionId === null ||
    companyId === null ||
    userId === null ||
    companyUserId === null ||
    issuedAt === null
  ) {
    return null
  }

  return { kind: TokenKind.Access, tokenId, sessionId, companyId, userId, companyUserId, issuedAt }
}

/** 驗證 refresh 票的簽章與形狀。是否已被作廢由資料庫那一列決定，見 {@link verifyAccessTokenSignature}。 */
export const verifyRefreshTicketSignature = (secret: string, token: string): RefreshTicketClaims | null => {
  const record = asRecord(readVerifiedPayload(secret, token))
  if (record === null) return null
  if (record['kind'] !== TokenKind.Refresh) return null

  const ticketId = readString(record, 'ticketId')
  const companyId = readString(record, 'companyId')
  const issuedAt = readString(record, 'issuedAt')
  if (ticketId === null || companyId === null || issuedAt === null) return null

  return { kind: TokenKind.Refresh, ticketId, companyId, issuedAt }
}

/** 建立 access token 的 claims（`kind` 由本函式填，呼叫端寫不出別的值）。 */
export const toAccessTokenClaims = (input: {
  readonly tokenId: string
  readonly sessionId: string
  readonly companyId: string
  readonly userId: string
  readonly companyUserId: string
  readonly issuedAt: string
}): AccessTokenClaims => ({ kind: TokenKind.Access, ...input })

/** 建立 refresh 票的 claims。 */
export const toRefreshTicketClaims = (input: {
  readonly ticketId: string
  readonly companyId: string
  readonly issuedAt: string
}): RefreshTicketClaims => ({ kind: TokenKind.Refresh, ...input })

/**
 * refresh 票原值的 SHA-256，用來與 `refresh_tokens.token_hash` 比對。
 *
 * **不加鹽、不用 HMAC**：這裡要的是「同一串字一定算出同一個值」以便查表比對，而票本身
 * 已經是 256 bit 的不可預測字串（簽章的部分），沒有字典攻擊的餘地。
 * 存 hash 而不存原值的理由與密碼相同（§5.1）：資料庫備份外流時，裡面沒有任何一張可以直接拿去用的票。
 */
export const hashTicket = (rawTicket: string): Buffer =>
  createHash('sha256').update(Buffer.from(rawTicket, 'utf8')).digest()

/** 定時比較兩段 hash。長度不同直接回 false，理由同 {@link signatureMatches}。 */
export const ticketHashMatches = (expected: Buffer, actual: Buffer): boolean => {
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/**
 * 算出一張 access token 的壽命（§1.3 的 `expiresIn` ／ `exp`）。
 *
 * **續期與發證共用這一支**，因此兩者永遠算出同一種值。`exp` 與 `expiresIn` 一起產出、
 * 不得只更新其中一個（§1.3）：兩者不同步時，log 上的截止時刻與實際被登出的時刻對不上，
 * 而追查登出問題時唯一的線索就是 log——線索本身在騙人，等於沒有線索。
 */
export const computeSessionLifetime = (clock: Clock, ttlSeconds: number): SessionRenewal => ({
  expiresIn: ttlSeconds,
  exp: clock.transportAfter(ttlSeconds),
})
