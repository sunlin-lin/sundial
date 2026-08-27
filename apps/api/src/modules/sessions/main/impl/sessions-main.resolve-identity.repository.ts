/**
 * 資料存取動作：**身分解析查詢**（§4.2 的排除適用範圍）。
 *
 * 這是全專案唯一一支**不帶 `company_id` 條件**的查詢，而它不是漏帶——**它就是產生那個條件的那一步**。
 * 沒有它，§4.2 的第一條規則在實作上是循環定義：它保護穩態，卻讓系統無法離開初始狀態。
 *
 * **§4.2 的三項邊界，這支查詢逐項對照**（三項全部成立才算數，缺一項它就是一個沒有邊界的豁免）：
 *
 * | 邊界 | 本函式 |
 * |---|---|
 * | 1. 必須以公司代號與帳號為條件 | `companies.company_code = ?` ＋ `users.username = ?`。**不是「沒有條件」，是換一組條件** |
 * | 2. 只能出現在認證模組的 repository | 本檔在 `modules/sessions/main/impl/`，且依 §0.3 只有本次目錄的入口檔 import 得到 |
 * | 3. 回傳欄位只能是公司範圍本身 | 三個識別 ＋ 密碼 hash，**沒有任何業務欄位**（見下） |
 *
 * 第 3 項最關鍵：**只要它能回傳業務欄位，它就是一個不帶公司條件的萬用查詢**，
 * 而它被放在認證模組裡，離所有「跨公司洩漏」的測試都很遠。密碼 hash 之所以可以在列上，
 * 是因為它是**驗證身分所需的材料**而不是業務資料——沒有它，§3.2 指定的正確作法
 *（以單一查詢解析身分、查不到就走與密碼錯誤同一條路徑）根本寫不出來。
 * 登入回應需要的顯示名稱與公司名稱由**另一支帶公司條件的查詢**取得（`find-profile`）。
 *
 * **狀態條件全部寫進同一個 `WHERE`，而不是查到之後再判斷。** 這是 §3.2 那條「四種原因必須無法區分」
 * 的實作手段，而且它涵蓋的不只四種：公司不存在、公司已停用、公司已刪除、帳號不存在、
 * 帳號不屬於這家公司、成員已停用——**全部**在這一支查詢裡收斂成同一個「查不到」。
 * 寫成一連串 `if` 之後，四個（或六個）分支各自 return 的程式碼，回應時間與訊息幾乎不可能完全一致，
 * 而每一次探測在系統看來都只是一次普通的登入失敗，沒有任何一層會告警。
 *
 * 顯式 `select` ＋ `join`，不使用 relational query API（§4.6）。
 */
import { and, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { companies, CompanyStatus, companyUsers, CompanyUserStatus, users } from '../../../../db/schema/index.ts'
import type { ResolvedLoginIdentity } from '../domain/session-model.ts'

/**
 * @param companyCode 使用者鍵入的公司代號，**待驗證的字串**（§4.2）。
 * @param username 使用者鍵入的帳號。
 * @returns 查無、或公司／成員任一方不是有效狀態時一律 `null`——呼叫端只看得到「有」或「沒有」，
 *   因此它**寫不出**依原因分歧的回應。
 */
export const resolveLoginIdentity = async (
  runner: QueryRunner,
  companyCode: string,
  username: string,
): Promise<ResolvedLoginIdentity | null> => {
  const rows = await runner
    .select({
      companyId: companyUsers.companyId,
      userId: users.id,
      companyUserId: companyUsers.id,
      passwordHash: users.passwordHash,
    })
    .from(companyUsers)
    .innerJoin(companies, eq(companies.id, companyUsers.companyId))
    // `users` 是全域表（沒有 `company_id`），因此這一段沒有公司條件——與 §4.2 無關，
    // 它本來就不屬於任何公司。成員關係（`company_users`）才是把帳號綁進某一家公司的那一列。
    .innerJoin(users, eq(users.id, companyUsers.userId))
    .where(
      and(
        eq(companies.companyCode, companyCode),
        // 軟刪除一律排除（§4.3）。用 `deleted_seq = 0` 而不是 `deleted_at IS NULL`：兩者等價，
        // 但前者落在 NOT NULL 且已進唯一鍵的欄位上，比對便宜也更容易被索引使用。
        eq(companies.deletedSeq, 0),
        // 公司停用 → 一律回「查不到」，與公司不存在**逐字相同**（§3.2）。
        eq(companies.status, CompanyStatus.Active),
        eq(users.username, username),
        // 成員停用（離職）→ 同上。這一條是「辦理離職後就登不進來」的唯一執行點。
        eq(companyUsers.status, CompanyUserStatus.Active),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}
