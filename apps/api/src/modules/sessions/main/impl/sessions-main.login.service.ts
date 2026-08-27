/**
 * 業務動作：登入。
 *
 * **本檔最重要的一段是前四行，而不是後面的發證。** §3.2 要求登入失敗的四種原因
 *（公司代號不存在／帳號不存在／密碼錯誤／該帳號不屬於這家公司）**無法區分**，
 * 而實作上最容易破口的地方是「先查公司、查不到就早退」這種分段驗證——
 * 四個分支各自 return 的程式碼，回應時間與訊息幾乎不可能完全一致。
 *
 * 正確作法是 §3.2 明文指定的那一種，也是下面寫的這一種：
 * **以公司代號 ＋ 帳號為單一查詢條件解析出身分，查不到就走與密碼錯誤同一條失敗路徑。**
 * 四種原因走的是**同一行 `return`**，想寫出不一致的回應都寫不出來；
 * 而查無帳號時也照樣跑一次密碼驗證（`passwordHashToVerify`），連回應時間都一樣。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { SessionsMainContext } from '../domain/session-context.ts'
import { chainExpiresAt, mintSession } from '../domain/session-issue.ts'
import type { LoginInput, LoginOutcome } from '../domain/session-model.ts'
import { passwordHashToVerify, verifyPassword } from '../domain/session-password.ts'
import { invalidCredentials } from '../sessions-main.errors.ts'
import { findSessionProfile, insertRefreshTicket, resolveLoginIdentity } from '../sessions-main.repository.ts'

export const login = async (
  context: SessionsMainContext,
  input: LoginInput,
): Promise<ServiceResult<LoginOutcome>> => {
  // 身分解析查詢（§4.2 的排除適用範圍）：公司不存在、公司停用、帳號不存在、帳號不屬於這家公司、
  // 成員已停用——全部在這一支查詢裡收斂成同一個 `null`。
  const resolved = await resolveLoginIdentity(context.db, input.companyCode, input.username)

  // **即使查無帳號也照樣驗一次密碼**（§3.2）。少了這一行，帳號存在時要跑一次 Argon2id（數十毫秒）、
  // 不存在時立刻回，兩者差一個數量級——回應時間會出賣答案，而公司代號與帳號就變成可枚舉的介面。
  const passwordMatches = await verifyPassword(input.password, passwordHashToVerify(resolved?.passwordHash ?? null))

  // 四種原因**同一行 return**。合併成一個條件不是為了少寫幾行，
  // 而是為了讓「回應依原因分歧」這件事在結構上寫不出來。
  if (resolved === null || !passwordMatches) return fail([invalidCredentials()])

  const ids = {
    // 新的一次登入 ＝ 新的一條輪替鏈（§5.4.7）。
    sessionId: crypto.randomUUID(),
    ticketId: crypto.randomUUID(),
    accessTokenId: crypto.randomUUID(),
  }

  const minted = mintSession({
    config: context.session,
    clock: context.clock,
    ids,
    subject: {
      // `companyId` 由「公司代號 ＋ 帳號 ＋ 密碼」三者一起驗證後**解析**出來，
      // 不是把使用者送來的 `companyCode` 轉一下就用（§4.2）。這裡是全系統唯一一個
      // 把 `companyId` 寫進 access token claims 的位置。
      companyId: resolved.companyId,
      userId: resolved.userId,
      companyUserId: resolved.companyUserId,
    },
  })

  await insertRefreshTicket(context.db, resolved.companyId, {
    id: ids.ticketId,
    sessionId: ids.sessionId,
    userId: resolved.userId,
    companyUserId: resolved.companyUserId,
    tokenHash: minted.ticketHash,
    issuedAt: minted.issuedAt,
    expiresAt: chainExpiresAt(context.clock, context.session),
    accessExpiresAt: minted.accessExpiresAt,
  })

  // 顯示用資料由**另一支帶公司條件的查詢**取得，而且只在密碼驗證通過之後才跑：
  // 登入失敗的路徑碰不到任何業務資料（§4.2 的第 3 項邊界）。
  const profile = await findSessionProfile(context.db, resolved.companyId, resolved.companyUserId)
  if (profile === null) {
    // 系統錯誤（§3.1.2）：身分才剛剛在同一次請求裡解析成功，這裡就查不到，
    // 代表資料庫或本模組的公司範圍有問題，不是使用者做錯了什麼。走例外路徑才會帶著堆疊進告警。
    // 訊息只帶識別碼，不帶帳號、公司代號或密碼的任何片段（§5.1）。
    throw new Error(`成員 ${resolved.companyUserId} 通過登入驗證後查不到顯示資料`)
  }

  return succeed({ identity: minted.identity, tokens: minted.tokens, lifetime: minted.lifetime, profile })
}
