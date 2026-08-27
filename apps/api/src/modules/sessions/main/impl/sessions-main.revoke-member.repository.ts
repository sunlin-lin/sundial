/**
 * 資料存取動作：作廢某位公司成員的**所有**輪替鏈。
 *
 * 兩個呼叫者，同一種操作、同一個範圍：
 * - `POST /sessions/main/logout-all`（登出所有裝置，§5.4.2）；
 * - 偷用偵測觸發的全鏈作廢（§5.4.2：「該使用者的所有 refresh token 全部作廢」）。
 *
 * 與 `revoke-chain` 的差別只有 `WHERE` 的那一欄——這正是 §5.4.7 說的
 * 「把『一次登入』寫成一個欄位，讓『登出這台裝置』與『登出所有裝置』變成同一種操作的兩個範圍」。
 *
 * **範圍是「公司成員」而不是「全域帳號」**，這一點與 §5.4.2 的字面（「該使用者的所有票」）
 * 有一處落差，必須寫清楚：本表帶 `company_id`，以全域帳號為範圍的作廢會是一次
 * **不帶公司條件的寫入**，而 §4.2 是本規範優先度最高的一條。同一個帳號在別家公司的登入
 * 屬於別家公司的範圍。多公司帳號的跨公司作廢需要另一條明確命名的平台管理路徑（§4.2），
 * 那條路徑目前不存在——已寫進交付回報的「規範問題」。
 */
import { eq, isNotNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'
import type { TicketRevocation } from '../domain/session-model.ts'

/**
 * @returns 實際作廢的列數 ＝ 這位成員原本有幾條活著的鏈（幾台裝置登入中）。
 */
export const revokeMemberChains = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  revocation: TicketRevocation,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    refreshTokens,
    { activeSessionId: null, revokedAt: revocation.at, revokedReason: revocation.reason, updatedAt: revocation.at },
    eq(refreshTokens.companyUserId, companyUserId),
    // 只動還有效的列，理由同 `revoke-chain`：已作廢的列是偷用偵測的依據，必須留著。
    isNotNull(refreshTokens.activeSessionId),
  )

  // 一次把多條鏈的有效票全部清成 NULL，不會撞唯一鍵：`NULL` 在 UNIQUE 索引中互不相等。
  return readAffectedRows(result)
}
