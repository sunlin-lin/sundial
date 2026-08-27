/**
 * 資料存取動作：依票的識別碼取回那一列（含**已作廢**的列）。
 *
 * **刻意連已作廢的列一起回傳，而不是在 `WHERE` 裡濾掉。** 這一點與其他模組的查詢相反
 *（那些一律 `deleted_seq = 0`），所以理由必須寫清楚：偷用偵測（§5.4.2）要回答的問題是
 * 「這張票是不是**曾經**有效、現在已經被換掉了」——把已作廢的列濾掉之後，
 * 「用一張已經換掉的票」與「用一張根本不存在的票」會長得一模一樣，而兩者的處置完全不同：
 * 前者是**該使用者的所有票全部作廢**，後者只是擋下這一次請求。
 * 偵測就是在這一行消失的，而消失之後沒有任何測試會變紅——輪替照樣運作。
 */
import type { Buffer } from 'node:buffer'
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'

export type StoredRefreshTicket = {
  readonly id: string
  readonly sessionId: string
  readonly userId: string
  readonly companyUserId: string
  readonly tokenHash: Buffer
  readonly expiresAt: string
  /** `null` 代表這張票仍然有效；非 `null` 代表它已被作廢（輪替、登出或偷用偵測）。 */
  readonly revokedAt: string | null
}

/**
 * @param companyId 公司範圍，來自**票上經過簽章的 claims**——它是伺服器自己簽的值，
 *   不是客戶端說了算的字串（§4.2 的信任方向）。
 * @returns 查無回 `null`。別家公司的票在查詢階段就等同於不存在（公司條件由封裝加上），
 *   因此「別家公司的票」與「這張票不存在」走的是同一行程式碼（§3.2）。
 */
export const findRefreshTicket = async (
  runner: QueryRunner,
  companyId: string,
  ticketId: string,
): Promise<StoredRefreshTicket | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .select(
      {
        id: refreshTokens.id,
        sessionId: refreshTokens.sessionId,
        userId: refreshTokens.userId,
        companyUserId: refreshTokens.companyUserId,
        tokenHash: refreshTokens.tokenHash,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
      },
      refreshTokens,
      eq(refreshTokens.id, ticketId),
    )
    .limit(1)

  return rows[0] ?? null
}
