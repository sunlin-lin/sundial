/**
 * 登入狀態的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道本次目錄對資料庫做了哪些事，
 * 一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 這裡的「動作」是**資料存取動作，不是端點動作**（§0.4）：`revokeSessionChain` 被登出端點與
 * 日後的改密碼流程共用，`insertRefreshTicket` 被登入與輪替共用。以端點為單位切的話，
 * 同一段寫入會被複製進好幾個切片（改一處漏一處，而且不會有任何地方變紅），
 * 或者切片開始互相 import（§0.4 禁止）。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { ResolvedLoginIdentity, SessionProfile, TicketRevocation } from './domain/session-model.ts'
import { consumeRefreshTicket as consumeRefreshTicketImpl } from './impl/sessions-main.consume-ticket.repository.ts'
import {
  findRefreshTicket as findRefreshTicketImpl,
  type StoredRefreshTicket,
} from './impl/sessions-main.find-ticket.repository.ts'
import { findSessionProfile as findSessionProfileImpl } from './impl/sessions-main.find-profile.repository.ts'
import {
  insertRefreshTicket as insertRefreshTicketImpl,
  type NewRefreshTicket,
} from './impl/sessions-main.insert-ticket.repository.ts'
import { resolveLoginIdentity as resolveLoginIdentityImpl } from './impl/sessions-main.resolve-identity.repository.ts'
import { revokeMemberChains as revokeMemberChainsImpl } from './impl/sessions-main.revoke-member.repository.ts'
import { revokeSessionChain as revokeSessionChainImpl } from './impl/sessions-main.revoke-chain.repository.ts'
import { touchAccessSession as touchAccessSessionImpl } from './impl/sessions-main.touch-session.repository.ts'

export type { NewRefreshTicket, StoredRefreshTicket }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。
 *
 * **刻意不另外宣告一份更窄的 `Pick<Database, …>`**：窄化擋的是「呼叫得到某個方法」，
 * 封裝擋的是「查詢漏掉公司條件」，而窄化過的 runner 交不給 `TenantDatabase`。
 */
export type { QueryRunner }

/**
 * **身分解析查詢**（§4.2 的排除適用範圍）。三項邊界與逐項對照寫在實作檔的檔頭。
 *
 * 它是全專案唯一一支不帶 `company_id` 條件的查詢，因此刻意放在入口的第一個位置
 * ——要質疑它的人第一眼就看得到，而不是埋在十幾支查詢中間。
 */
export const resolveLoginIdentity = (
  runner: QueryRunner,
  companyCode: string,
  username: string,
): Promise<ResolvedLoginIdentity | null> => resolveLoginIdentityImpl(runner, companyCode, username)

export const findSessionProfile = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<SessionProfile | null> => findSessionProfileImpl(runner, companyId, companyUserId)

export const insertRefreshTicket = (runner: QueryRunner, companyId: string, ticket: NewRefreshTicket): Promise<void> =>
  insertRefreshTicketImpl(runner, companyId, ticket)

export const findRefreshTicket = (
  runner: QueryRunner,
  companyId: string,
  ticketId: string,
): Promise<StoredRefreshTicket | null> => findRefreshTicketImpl(runner, companyId, ticketId)

export const consumeRefreshTicket = (
  runner: QueryRunner,
  companyId: string,
  ticketId: string,
  revocation: TicketRevocation,
): Promise<number> => consumeRefreshTicketImpl(runner, companyId, ticketId, revocation)

export const revokeSessionChain = (
  runner: QueryRunner,
  companyId: string,
  sessionId: string,
  revocation: TicketRevocation,
): Promise<number> => revokeSessionChainImpl(runner, companyId, sessionId, revocation)

/** @returns 實際被作廢的 token id 清單（稽核計畫 §7 Stage 2 用得到；`logout-all` 只取 `.length`）。 */
export const revokeMemberChains = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  revocation: TicketRevocation,
): Promise<readonly string[]> => revokeMemberChainsImpl(runner, companyId, companyUserId, revocation)

export const touchAccessSession = (
  runner: QueryRunner,
  companyId: string,
  sessionId: string,
  now: string,
  accessDeadline: string,
): Promise<boolean> => touchAccessSessionImpl(runner, companyId, sessionId, now, accessDeadline)
