/**
 * 業務動作:某位公司成員的登入帳號被停用時,在**同一筆交易**內作廢他所有的 refresh token 鏈。
 *
 * 安全落差修補:`company_users.status` 只在登入那一刻被檢查
 * (`sessions-main.resolve-identity.repository.ts`),access token 續期(`touchAccessSession`)
 * 與 refresh 完全不查這個欄位。停用一個帳號之後,對方手上已經發出的 access token 會用到過期,
 * 而 refresh 票甚至還能繼續換出新的 access token——等於停用要等到下一次重新登入才生效。
 * 本檔把「作廢該成員的所有 refresh token 鏈」補進停用動作,讓停用立即生效。
 *
 * **這個動作沒有對應的端點**,呼叫者是 `company-users/main` 的兩條停用路徑:管理者直接停用
 * (`company-users-main.deactivate-account.service.ts`)與離職流程的內部停用動作
 * (`company-users-main.deactivate.service.ts`)。§0.4 明文允許沒有端點、呼叫者是別的模組的
 * 業務動作。
 *
 * ## 為什麼收 `TransactionRunner`,不是 `QueryRunner`
 *
 * 停用帳號與作廢 session 必須是同一筆交易:只作廢成功、停用失敗的話,這個人被登出了但帳號
 * 其實還是啟用的(下次登入又進得來);反過來停用成功、作廢失敗,就是這次要修的安全落差本身。
 * `TransactionRunner`(`db/client.ts`)讓「呼叫端真的傳了交易」變成編譯期保證——傳裸連線池
 * 進來是編譯錯誤,不必等 review 或整合測試才發現。
 *
 * ## 為什麼這裡不呼叫 `recordAudit`
 *
 * 與 `revokeChainsOnReuse`(偷用偵測,系統自己發現的獨立安全事件,沒有其他地方會描述它)不同,
 * 這裡的作廢**是**帳號停用這件事本身的一部分,而帳號停用已經在呼叫端的交易裡記了一筆
 * `company_users.status: ACTIVE → INACTIVE` 的稽核。若這裡再記一筆,同一次操作會被兩筆
 * 稽核各自描述一次。因此本檔只做作廢、把「作廢了哪幾張票」回傳,由呼叫端併進它自己那一筆
 * 稽核的 `revokedTokenIds` 欄位(`audit-field-policy.ts` 的 `company_users.revokedTokenIds`,
 * 原本只有 `revokeChainsOnReuse` 在用,這裡是第二個呼叫者,欄位政策本身不必變動)。
 */
import { RefreshTokenRevokeReason } from '../../../../db/schema/index.ts'
import type { TransactionRunner } from '../../../../db/client.ts'
import { revokeMemberChains } from '../sessions-main.repository.ts'

/**
 * @param now 台北牆鐘時間,**由呼叫端傳入而不是這裡自己取**:必須與呼叫端同一次操作寫下的
 *   其他時間戳(`company_users.deactivated_at`、稽核的 `created_at`)完全相同,理由與
 *   `company-users-main.deactivate.service.ts` 的 `now` 參數相同。
 * @returns 實際被作廢的 token id 清單,呼叫端可直接序列化進自己的稽核 `changes`。
 *   找不到任何活躍的鏈時回空陣列(這個成員從未登入過,或帳號早已被停用過一次)——這是合法的
 *   空操作,不是錯誤。
 */
export const revokeSessionsForDeactivation = (
  tx: TransactionRunner,
  companyId: string,
  companyUserId: string,
  now: string,
): Promise<readonly string[]> =>
  revokeMemberChains(tx, companyId, companyUserId, { at: now, reason: RefreshTokenRevokeReason.AccountDeactivated })
