/**
 * 資料存取動作：作廢某位公司成員的**所有**輪替鏈。
 *
 * 兩個呼叫者，同一種操作、同一個範圍：
 * - `POST /sessions/main/logout-all`（登出所有裝置，§5.4.2）；
 * - 偷用偵測觸發的全鏈作廢（§5.4.2：「該使用者的所有 refresh token 全部作廢」；稽核計畫
 *   §7 Stage 2 的三筆欠帳之一，`sessions.main.refresh-token-reuse`）。
 *
 * 與 `revoke-chain` 的差別只有 `WHERE` 的那一欄——這正是 §5.4.7 說的
 * 「把『一次登入』寫成一個欄位，讓『登出這台裝置』與『登出所有裝置』變成同一種操作的兩個範圍」。
 *
 * **範圍是「公司成員」而不是「全域帳號」**，這一點與 §5.4.2 的字面（「該使用者的所有票」）
 * 有一處落差，必須寫清楚：本表帶 `company_id`，以全域帳號為範圍的作廢會是一次
 * **不帶公司條件的寫入**，而 §4.2 是本規範優先度最高的一條。同一個帳號在別家公司的登入
 * 屬於別家公司的範圍。多公司帳號的跨公司作廢需要另一條明確命名的平台管理路徑（§4.2），
 * 那條路徑目前不存在——已寫進交付回報的「規範問題」。
 *
 * **先查再依 id 更新，不是單一句 `UPDATE ... WHERE`**——這是為了稽核而換的形狀（稽核計畫
 * §7 Stage 2）：偷用偵測那個呼叫者要把「這次事件實際作廢了哪幾張票」寫進 `changes`（token 是
 * 短命資料，主體是成員但票的 id 仍是唯一能事後追查到「當時是哪幾台裝置」的線索），MySQL 的
 * `UPDATE` 不支援 `RETURNING`，因此只能先查出會被影響的那幾個 id、依 id 更新，再把同一份 id
 * 清單回傳給呼叫端。`logout-all` 不需要這份清單，但共用同一支函式（見檔頭）比維護兩份幾乎
 * 一樣的查詢便宜。
 */
import { eq, inArray, isNotNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'
import type { TicketRevocation } from '../domain/session-model.ts'

/**
 * @returns 實際被作廢的 token id 清單 ＝ 這位成員原本有幾條活著的鏈（幾台裝置登入中）。
 *   呼叫端只需要數量時取 `.length` 即可（見 `logout-all` 切片）。
 */
export const revokeMemberChains = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  revocation: TicketRevocation,
): Promise<readonly string[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  const activeRows = await tenant.select(
    { id: refreshTokens.id },
    refreshTokens,
    eq(refreshTokens.companyUserId, companyUserId),
    // 只動還有效的列，理由同 `revoke-chain`：已作廢的列是偷用偵測的依據，必須留著。
    isNotNull(refreshTokens.activeSessionId),
  )
  const tokenIds = activeRows.map((row) => row.id)
  // 沒有活著的鏈時，`inArray(..., [])` 會組出一句恆假的 `WHERE`，直接跳過那次往返即可。
  if (tokenIds.length === 0) return []

  // 依 id 更新，不會撞唯一鍵：一次把多條鏈的有效票全部清成 NULL，
  // `NULL` 在 `uq_refresh_tokens_active_session` 這種 UNIQUE 索引中互不相等。
  await tenant.update(
    refreshTokens,
    { activeSessionId: null, revokedAt: revocation.at, revokedReason: revocation.reason, updatedAt: revocation.at },
    inArray(refreshTokens.id, tokenIds),
  )

  return tokenIds
}
