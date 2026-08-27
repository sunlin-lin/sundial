/**
 * 資料存取動作：作廢**整條輪替鏈**（§5.4.7）。
 *
 * 條件是 `session_id`，不是票的識別碼——這正是「一次登入」那個欄位存在的理由。
 *
 * **為什麼不能只作廢手上那一張**（兩種做法在多數情況下看起來一模一樣，所以理由要寫死）：
 * 任何時刻只有最新那張是活的，因此單分頁情境下兩者效果相同。差別出在「手上的票不是最新那張」
 * 的時候，而多分頁是本系統的日常：A 分頁已經換過票、鏈走到 T4，B 分頁手上還是 T3。
 * 此時 B 分頁按下登出，只作廢單張的做法**廢掉的是早就已經失效的 T3，而 T4 還活著**
 * ——畫面乾淨地回到登入頁，**session 卻沒有斷**。「以為作廢了、其實沒有」，
 * 沒有效果卻讓人放心，比什麼都沒做更危險（§5.4.5 的原話）。
 *
 * 以 `session_id` 為條件之後，「手上是哪一張票」這個問題連問都不會被問到——
 * 也就沒有那段判斷邏輯可以寫錯。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'
import type { TicketRevocation } from '../domain/session-model.ts'

/**
 * @returns 實際作廢的列數。一條鏈同時只有一列未作廢，因此正常情況下是 0 或 1；
 *   0 代表這條鏈已經沒有有效票了（重複登出、或這條鏈剛剛被偷用偵測作廢掉）。
 */
export const revokeSessionChain = async (
  runner: QueryRunner,
  companyId: string,
  sessionId: string,
  revocation: TicketRevocation,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    refreshTokens,
    { activeSessionId: null, revokedAt: revocation.at, revokedReason: revocation.reason, updatedAt: revocation.at },
    // 以 `active_session_id` 為條件而不是 `session_id`：兩者在有效的那一列上相等，
    // 但前者**只命中還有效的那一列**——已作廢的列必須原樣留著，
    // 偷用偵測要靠它們才看得出「這張票曾經有效、現在已經被換掉了」（見 `find-ticket` 的檔頭）。
    // 而且這個條件正好走 `uq_refresh_tokens_active_session` 這條唯一索引。
    eq(refreshTokens.activeSessionId, sessionId),
  )

  return readAffectedRows(result)
}
