/**
 * 資料存取動作：寫入一張新的 refresh 票。
 *
 * 登入（開一條新鏈）與輪替（延長既有的鏈）都走這一支，差別只在 `sessionId` 是新的還是沿用的
 * ——這正是 §5.4.7 那個「一次登入」欄位帶來的好處：兩件事在資料上是同一種寫入。
 *
 * **不做「先查有沒有有效票再寫」**（§4.3）：兩個併發的輪替請求會同時查到「沒有」然後都寫進去，
 * 於是同一條鏈出現兩張有效票，而「舊票已作廢」正是偷用偵測的前提。
 * 由 `uq_refresh_tokens_active_session`（`company_id` ＋ `active_session_id`）擋，
 * 第二個請求會撞唯一鍵——那是資料庫層的保證，併發下也成立。
 */
import type { Buffer } from 'node:buffer'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { refreshTokens } from '../../../../db/schema/index.ts'

export type NewRefreshTicket = {
  readonly id: string
  /** 一次登入（§5.4.7）。輪替時**沿用**同一個值，登入時才產生新的。 */
  readonly sessionId: string
  readonly userId: string
  readonly companyUserId: string
  /** 票原值的 SHA-256。**原值不進資料庫**（§5.4.3）。 */
  readonly tokenHash: Buffer
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly issuedAt: string
  /** 這條鏈的絕對截止。輪替時沿用，不重新計算——理由見 schema 的欄位註解。 */
  readonly expiresAt: string
  /** access token 的滑動視窗截止。 */
  readonly accessExpiresAt: string
}

export const insertRefreshTicket = async (
  runner: QueryRunner,
  companyId: string,
  ticket: NewRefreshTicket,
): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  await tenant.insert(refreshTokens, (scopedCompanyId) => ({
    id: ticket.id,
    // 公司 ID 只有這一個來源（封裝內部的私有欄位）：呼叫端拿不到別的值，
    // 因此「把票寫進別家公司」不是「要小心避免」而是寫不出來（§4.2）。
    companyId: scopedCompanyId,
    sessionId: ticket.sessionId,
    // 新票一定是有效的，因此 `active_session_id` 等於 `session_id`（作廢時才清成 NULL）。
    // 這一欄由本層填而不是由呼叫端傳：它是資料表的約束機制，不是業務決定——
    // 交給呼叫端就會有人「順手」填成 null，而那張票會從一發出去就註冊不上這條鏈。
    activeSessionId: ticket.sessionId,
    userId: ticket.userId,
    companyUserId: ticket.companyUserId,
    tokenHash: ticket.tokenHash,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
    accessExpiresAt: ticket.accessExpiresAt,
    revokedAt: null,
    revokedReason: null,
    createdAt: ticket.issuedAt,
    updatedAt: ticket.issuedAt,
  }))
}
