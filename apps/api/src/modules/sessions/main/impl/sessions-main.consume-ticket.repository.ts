/**
 * 資料存取動作：**消耗**一張 refresh 票（一次性使用，§5.4.2）。
 *
 * 這是本模組最重要的一支查詢，因為偷用偵測的正確性完全建立在它是**條件式 UPDATE**（§4.4）上：
 * 「這張票還沒被用過」寫進 `WHERE`，由資料庫在同一句話裡完成判斷與寫入。
 *
 * **先讀再寫是錯的**（`if (ticket.revokedAt === null) revoke(...)`）：兩個併發請求會同時讀到
 * 「還沒被用過」，然後都去換票——於是同一條鏈換出兩張新票，兩個持有者都覺得自己是正常的，
 * 而偷用偵測**一次也不會觸發**。這正是「票被偷」最典型的樣子（攻擊者與使用者同時在用），
 * 也就是說：寫成先讀再寫，這套機制在它最該生效的情境下剛好失效。
 *
 * 條件式 UPDATE 之下，第二個請求影響 0 列，呼叫端據此判定為偷用——**不是「順便擋一下」，
 * 是唯一的判定依據**。
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'
import type { TicketRevocation } from '../domain/session-model.ts'

/**
 * @returns 影響列數。**1 ＝ 本次請求取得了這張票的使用權**；0 ＝ 這張票已經被用過或被作廢
 *   （呼叫端一律視為外洩，§5.4.2）。
 */
export const consumeRefreshTicket = async (
  runner: QueryRunner,
  companyId: string,
  ticketId: string,
  revocation: TicketRevocation,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    refreshTokens,
    {
      // 清成 NULL 就是「這一列不再是這條鏈的有效票」，唯一鍵據此放行下一張新票。
      activeSessionId: null,
      revokedAt: revocation.at,
      revokedReason: revocation.reason,
      updatedAt: revocation.at,
    },
    eq(refreshTokens.id, ticketId),
    // 「預期的目前狀態」寫進 WHERE（§4.4）。兩個條件都要：`active_session_id` 是唯一鍵看的那一欄，
    // `revoked_at IS NULL` 是人在讀資料時看的那一欄——只寫其中一個，另一個哪天被寫歪了不會有人發現。
    and(isNotNull(refreshTokens.activeSessionId), isNull(refreshTokens.revokedAt)),
  )

  // 影響列數在這裡是**業務規則的依據**而不是除錯資訊：取不到就必須當場中止（見 `db/driver-result.ts`）。
  // 把取不到當成 0 會讓每一次正常輪替都被判成偷用，整個公司同時被登出。
  return readAffectedRows(result)
}
