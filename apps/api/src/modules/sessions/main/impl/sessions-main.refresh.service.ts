/**
 * 業務動作：換發新的 access token ＋ 新的 refresh 票（§5.4.2 的輪替）。
 *
 * **舊票已經在憑證驗證器那一步被消耗掉了**（`impl/sessions-main.verify-ticket.service.ts`），
 * 因此本動作只負責「發下一張」。順序是刻意的：先消耗、後發證。
 * 反過來（先發證、後消耗）會在發證成功而消耗失敗時留下兩張有效票，
 * 而「舊票已作廢」正是偷用偵測的前提；本順序的最壞情況是這條鏈少了一張票、使用者重新登入一次
 * ——安全機制出錯時應該倒向「太嚴」而不是「太鬆」。
 *
 * §1.3 來源②：**這支端點不續期，它發證。** 手上根本沒有 access token 可以續
 * ——refresh 群組驗的是 refresh 票，這正是那個群組的續期行為被定義成「不續期，改為發證」的原因。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { mintSession } from '../domain/session-issue.ts'
import type { ConsumedRefreshTicket, RefreshOutcome } from '../domain/session-model.ts'
import { findRefreshTicket, insertRefreshTicket } from '../sessions-main.repository.ts'

export const refreshSession = async (
  context: SessionsMainContext,
  consumed: ConsumedRefreshTicket,
): Promise<ServiceResult<RefreshOutcome>> => {
  // 重讀剛剛被消耗的那一列，為的是**沿用這條鏈的絕對截止時刻**（§5.4.1 的 30 天）。
  // 不重算一個新的 30 天：那會讓鏈在持續使用下無限延長，「refresh token 壽命 30 天」
  // 就變成一句沒有效力的話。截止時刻只有資料庫那一列知道，票上刻意不帶（見 session-token.ts）。
  const previous = await findRefreshTicket(context.db, consumed.identity.companyId, consumed.ticketId)
  if (previous === null) {
    // 系統錯誤（§3.1.2）：這一列在同一次請求的前一步才剛被 UPDATE 過，現在卻讀不到。
    // 不是使用者做錯了什麼，走例外路徑才會帶著堆疊進告警。
    throw new Error(`refresh 票 ${consumed.ticketId} 在消耗後於同一次請求內讀不回來`)
  }

  const ids = {
    // **沿用同一條鏈**（§5.4.7）：這是「換票不等於重新登入」在資料上的全部意義。
    // 換一個新的 sessionId 的話，登出就只作廢得到最後那一段，前面幾段全部留著還活著。
    sessionId: consumed.identity.sessionId,
    ticketId: crypto.randomUUID(),
    accessTokenId: crypto.randomUUID(),
  }

  const minted = mintSession({
    config: context.session,
    clock: context.clock,
    ids,
    subject: {
      companyId: consumed.identity.companyId,
      userId: consumed.identity.userId,
      companyUserId: consumed.identity.companyUserId,
    },
  })

  await insertRefreshTicket(context.db, consumed.identity.companyId, {
    id: ids.ticketId,
    sessionId: ids.sessionId,
    userId: consumed.identity.userId,
    companyUserId: consumed.identity.companyUserId,
    tokenHash: minted.ticketHash,
    issuedAt: minted.issuedAt,
    // 沿用，不重算。見本檔開頭與 schema 的欄位註解。
    expiresAt: previous.expiresAt,
    accessExpiresAt: minted.accessExpiresAt,
  })

  // 這支動作目前永遠不會回傳失敗結果，簽章仍然是 `ServiceResult`（而不是直接回 `RefreshOutcome`）。
  // 不是為了對稱：它讓 handler 的形狀與其他端點完全一致（走同一支 `resolveServiceResult`、
  // 同一條 envelope 出口，§1.8.4），因此日後真的長出一條業務規則時——例如
  // 「這個成員已被停用，不准換票」——加的是一行 `fail([...])`，而不是把 handler、
  // 錯誤映射與回應型別整組改掉。
  return succeed({ identity: minted.identity, tokens: minted.tokens, lifetime: minted.lifetime })
}
