/**
 * 登入狀態的純函式測試（§7.1）。
 *
 * 這裡測的是**不需要資料庫就成立的那一半**：簽章、票的種類、hash 比對、壽命計算。
 * 需要資料庫才造得出來的情境（輪替、偷用偵測、整條鏈作廢、即時撤銷）在
 * `sessions-main.endpoints.test.ts`——那些必須從 HTTP 打進去，因為要測的不只是業務規則，
 * 還包括 envelope 的形狀、status 與 `code` 的映射，以及 cookie 屬性。
 *
 * **打的是 `domain/`，不是 `impl/`**（§0.4：`impl/` 底下的檔案連測試都不得 import）。
 */
import { describe, expect, test } from 'bun:test'
import { fixedClock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'
import { chainExpiresAt, mintSession } from '../domain/session-issue.ts'
import { hashPassword, passwordHashToVerify, verifyPassword } from '../domain/session-password.ts'
import {
  computeSessionLifetime,
  hashTicket,
  ticketHashMatches,
  verifyAccessTokenSignature,
  verifyRefreshTicketSignature,
} from '../domain/session-token.ts'

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

const config: SessionConfig = {
  accessTokenSecret: 'test-only-secret-not-used-anywhere-else',
  accessTokenTtlSeconds: 7200,
  refreshTokenTtlDays: 30,
}

const ids = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  ticketId: '22222222-2222-4222-8222-222222222222',
  accessTokenId: '33333333-3333-4333-8333-333333333333',
}

const subject = {
  companyId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
  companyUserId: '66666666-6666-4666-8666-666666666666',
}

const mint = () => mintSession({ config, clock, ids, subject })

describe('sessions/main domain：發證與簽章', () => {
  test('access token 的 claims 帶得回身分，且 companyId 非空（§4.2）', () => {
    const minted = mint()
    const claims = verifyAccessTokenSignature(config.accessTokenSecret, minted.tokens.accessToken)

    if (claims === null) throw new Error('剛簽出來的 access token 驗不過')
    expect(claims.sessionId).toBe(ids.sessionId)
    expect(claims.userId).toBe(subject.userId)
    expect(claims.companyUserId).toBe(subject.companyUserId)
    // §4.2 ✅（測試：發證路徑必須有一條斷言 claims 的 companyId 非空）。
    // 一張沒有公司的票實質上是一張繞過公司隔離檢查的票，而它在型別上完全合法。
    expect(claims.companyId).toBe(subject.companyId)
    expect(claims.companyId).not.toBe('')
  })

  test('換一把金鑰就驗不過（簽章真的有在驗）', () => {
    const minted = mint()
    expect(verifyAccessTokenSignature('another-secret', minted.tokens.accessToken)).toBeNull()
  })

  test('動過 payload 一個字元就驗不過', () => {
    const minted = mint()
    const [payload, signaturePart] = minted.tokens.accessToken.split('.')
    if (payload === undefined || signaturePart === undefined) throw new Error('票的形狀不是 payload.簽章')

    const tampered = `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signaturePart}`
    expect(verifyAccessTokenSignature(config.accessTokenSecret, tampered)).toBeNull()
  })

  /**
   * §5.4.1：refresh token 只認一個端點，出現在其他請求上一律視為錯誤。
   *
   * 這條測試守的是那句話的執行手段（payload 裡的 `kind`）。少了它，兩張票都是同一把金鑰簽出來的字串，
   * 把 refresh 票放進 `Authorization: Bearer` 會**通過** access token 的驗證——
   * 於是 refresh 票就只是一張 30 天壽命的 access token，兩張票的設計當場失效。
   */
  test('refresh 票不能當 access token 用，反之亦然', () => {
    const minted = mint()
    expect(verifyAccessTokenSignature(config.accessTokenSecret, minted.tokens.refreshTicket)).toBeNull()
    expect(verifyRefreshTicketSignature(config.accessTokenSecret, minted.tokens.accessToken)).toBeNull()
  })

  test('refresh 票的 claims 只帶 ticketId 與 companyId（身分一律由資料庫那一列解析）', () => {
    const minted = mint()
    const claims = verifyRefreshTicketSignature(config.accessTokenSecret, minted.tokens.refreshTicket)

    if (claims === null) throw new Error('剛簽出來的 refresh 票驗不過')
    expect(claims.ticketId).toBe(ids.ticketId)
    expect(claims.companyId).toBe(subject.companyId)
    // 票上沒有身分：它不會隨著資料庫的作廢狀態改變，拿它去做事就等於用一份過期的副本。
    expect(JSON.stringify(claims)).not.toContain(subject.userId)
    expect(JSON.stringify(claims)).not.toContain(subject.companyUserId)
  })

  test('token_hash 對得上原值，改一個字元就對不上（定時比較）', () => {
    const minted = mint()
    expect(ticketHashMatches(minted.ticketHash, hashTicket(minted.tokens.refreshTicket))).toBe(true)
    expect(ticketHashMatches(minted.ticketHash, hashTicket(`${minted.tokens.refreshTicket}x`))).toBe(false)
  })

  /**
   * §1.3：`expiresIn` 是**新票的完整壽命**，且 `exp` 必須與它同步。
   * 兩者不同步時，log 上的截止時刻與實際被登出的時刻對不上，而追查登出問題時唯一的線索就是 log。
   */
  test('發證的壽命等於設定值，且與續期用的是同一份實作', () => {
    const minted = mint()
    expect(minted.lifetime.expiresIn).toBe(config.accessTokenTtlSeconds)
    // 台北 12:00:00 ＋ 7200 秒 = 14:00:00，帶 +08:00 偏移（§6.1：`exp` 是唯三可帶偏移的欄位之一）。
    expect(minted.lifetime.exp).toBe('2026-08-27T14:00:00+08:00')
    // 續期與發證共用同一支：兩者算出來的必須逐字相同，否則登入與續期回的秒數會分岔。
    expect(computeSessionLifetime(clock, config.accessTokenTtlSeconds)).toEqual(minted.lifetime)
  })

  test('access token 的滑動視窗截止與鏈的絕對截止分別是 2 小時與 30 天後', () => {
    const minted = mint()
    expect(minted.issuedAt).toBe('2026-08-27 12:00:00')
    expect(minted.accessExpiresAt).toBe('2026-08-27 14:00:00')
    expect(chainExpiresAt(clock, config)).toBe('2026-09-26 12:00:00')
  })

  test('cookie 的 Max-Age 等於 refresh token 的完整壽命秒數', () => {
    expect(mint().tokens.refreshMaxAgeSeconds).toBe(30 * 24 * 60 * 60)
  })
})

describe('sessions/main domain：密碼', () => {
  test('雜湊是 argon2id，且驗得回來', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  /**
   * §3.2 在時間維度上的那一半：查無帳號時也必須跑一次密碼驗證。
   *
   * 這條測試證明「陪跑用的假 hash」真的是一個**驗得動、但永遠不會成功**的 hash
   * ——若它是一串壞掉的字串，`verifyPassword` 會拋例外而不是回 false，
   * 於是查無帳號會走系統錯誤路徑，回應時間與 status 都與密碼錯誤不同，等於答案又被洩漏了。
   */
  test('查無帳號時的陪跑 hash 驗得動，而且驗不過', async () => {
    const hash = passwordHashToVerify(null)
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('anything at all', hash)).toBe(false)
  })

  test('查得到帳號時用的是那個帳號自己的 hash', async () => {
    const stored = await hashPassword('the real one')
    expect(passwordHashToVerify(stored)).toBe(stored)
  })
})
