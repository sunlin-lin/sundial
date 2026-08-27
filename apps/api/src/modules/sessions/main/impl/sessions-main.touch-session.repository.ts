/**
 * 資料存取動作：**檢查這條鏈還活著沒有，順手把 access token 的滑動視窗往後推**（§1.3、§5.4.6）。
 *
 * 這一支是 §5.4.6「access token 必須可即時撤銷（沒有殘留視窗）」的執行點：
 * **每一個請求都查一次，不做任何跨請求快取。**
 *
 * §5.4.6 三個理由裡最有份量的是第三個，所以抄在這裡：加了 TTL 快取之後，那個
 * 「已被撤銷的權限還能再用幾秒」的視窗**在測試裡永遠是 0 秒，只在正式環境發作**
 * ——測試中撤銷與下一個請求之間隔不到一毫秒，快取還沒被填進去，測試會全綠；
 * 正式環境有持續流量把快取填滿、有多個節點各自持有副本，於是「登出後還能操作幾秒」真的發生，
 * 而且沒有任何一條測試涵蓋它。一個只在正式環境成立、且無法被測試證偽的安全行為，等於沒有這個行為。
 *
 * **為什麼是「先讀再寫」而不是一句條件式 UPDATE**（§4.4 一般要求後者，這裡是有意的例外）：
 * MySQL 的 `affectedRows` 預設回的是**實際變更的列數**，而不是命中的列數。續期寫進去的值
 *（新的截止時刻）在同一秒內的第二個請求會與既有值**完全相同**，於是 `affectedRows` 是 0——
 * 若拿它當「這條鏈還在不在」的判斷依據，一個正常的高頻使用者會被判成已登出。
 * 因此判斷由 SELECT 負責（它的答案不受「值有沒有變」影響），UPDATE 只負責把視窗往後推。
 *
 * 這個順序不影響 §5.4.6 的驗收：那條要求的是「撤銷之後的**下一個**請求回 `900`」，
 * 而下一個請求的 SELECT 發生在撤銷 commit 之後，必然讀不到有效列。
 * 唯一的空窗是「與撤銷真正同時發生」的那一個請求，那在任何設計下都無法消除。
 */
import { eq, gt } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'

/**
 * @param now 台北牆鐘的「現在」，由注入的 clock 取得（§6.2）。
 *   **刻意不用 SQL 的 `NOW()`**：那會讓「現在」有第二個來源，而測試無法把它釘住，
 *   於是「票在正確的那一秒過期」這件事就永遠測不到。
 * @param accessDeadline 續期後的 access token 截止時刻（現在 ＋ 滑動視窗長度）。
 * @returns `true` ＝ 這條鏈仍然有效（已續期）；`false` ＝ 已被作廢、或已過期，呼叫端據此回 `900`。
 */
export const touchAccessSession = async (
  runner: QueryRunner,
  companyId: string,
  sessionId: string,
  now: string,
  accessDeadline: string,
): Promise<boolean> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .select(
      { id: refreshTokens.id },
      refreshTokens,
      // 這條鏈還有一列有效 ＝ 這次登入還活著。登出／登出所有裝置／偷用偵測都是把那一列
      // 的 `active_session_id` 清成 NULL，因此三者的效果在這裡是**同一個條件**，
      // 不需要三段判斷（也就沒有「漏判其中一種」的可能）。
      eq(refreshTokens.activeSessionId, sessionId),
      // 滑動視窗：停止操作超過一個視窗長度就過期（§5.4.1）。
      // 字串比大小在 `YYYY-MM-DD HH:mm:ss` 這個格式上等於時間比大小（零補位、由大到小排列）。
      gt(refreshTokens.accessExpiresAt, now),
      // 鏈的絕對截止（§5.4.1 的 30 天）：到了就得重新登入，再怎麼滑也滑不過去。
      gt(refreshTokens.expiresAt, now),
    )
    .limit(1)

  if (rows[0] === undefined) return false

  // 續期（§1.3 來源①）。與處理結果**完全無關**——驗證通過就續期，不管後面發生什麼；
  // 反過來把續期綁在「處理成功」上，使用者連續填錯三次表單就會被登出。
  await tenant.update(
    refreshTokens,
    { accessExpiresAt: accessDeadline, updatedAt: now },
    eq(refreshTokens.activeSessionId, sessionId),
  )

  return true
}
