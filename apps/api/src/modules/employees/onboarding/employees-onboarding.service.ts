/**
 * 到職編排的業務入口（§0.4）。
 *
 * **這裡是整個 Stage 4 唯一開交易的地方**（計畫 §4.1：「編排點自己開那唯一的一個交易」）。
 * `context.db.transaction(...)` 包住 impl 的 `createOnboardingInTransaction`，六個被編排的
 * 子動作（員工、任職、部門歸屬、扣繳、帳號、角色）全部共用同一個 `tx`。
 *
 * ## ★ 本檔同時負責「失敗時真的 ROLLBACK」
 *
 * 完整理由見 `impl/employees-onboarding.create.service.ts` 檔頭，這裡只重述會影響這支函式
 * 寫法的結論：**drizzle 的 `db.transaction(cb)` 只依 `cb` 是否 reject 決定 commit／rollback，
 * 不看回傳值的內容**。如果 `createOnboardingInTransactionImpl` 因為第 5 步（角色指派）失敗而
 * 回傳 `{ ok: false, errors }`，而這裡只是把它原樣 `return`，drizzle 會把它當成「回呼正常結束」
 * 而 **commit**——前面已經成功寫入的員工、任職、部門歸屬、扣繳設定、登入帳號會全部留在資料庫裡，
 * 只有角色指派缺席，而這正是計畫要防止的「沒有任職、沒有帳號的員工」的同類事故。
 *
 * 因此任一步失敗時，這裡呼叫 `tx.rollback()`（型別 `never`，見 `db/client.ts` 的
 * `TransactionRunner`）強制讓交易真的 ROLLBACK；它會丟出 drizzle 的
 * `TransactionRollbackError`，讓 `context.db.transaction(...)` 整個 reject。本函式在外層
 * `catch` 住這個 reject，換回原本要回的 `ServiceResult`——**這個形狀與 `company-users/roles`
 * 的 `revokeRoles`（`RevocationConflict` 攔截）同構**：交易邊界所在的入口層才知道要把「交易被迫
 * 回滾」這個訊號轉譯回業務錯誤，`impl/` 只管跑到哪一步、不管交易怎麼收尾。
 *
 * 用一個外層變數 `failure`接住要回傳的內容，是因為 `tx.rollback()` 呼叫之後**不會回傳**
 * （它的型別就是 `never`）——沒有機會把 `ServiceResult` 當成回傳值一路帶出 `.transaction(...)`，
 * 只能在呼叫它之前先存起來，等交易真正回滾（reject）之後從外層的 `catch` 拿出來用。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { OnboardingContext } from './domain/onboarding-context.ts'
import type { CreateOnboardingInput, OnboardingResult } from './domain/onboarding-model.ts'
import { createOnboardingInTransaction as createOnboardingInTransactionImpl } from './impl/employees-onboarding.create.service.ts'

export type { OnboardingContext }
export type { CreateOnboardingInput, OnboardingResult } from './domain/onboarding-model.ts'

/** 端點動作：`POST /employees/onboarding/create`（已登入群組）。 */
export const createOnboarding = async (
  context: OnboardingContext,
  input: CreateOnboardingInput,
): Promise<ServiceResult<OnboardingResult>> => {
  let failure: ServiceResult<OnboardingResult> | null = null

  try {
    return await context.db.transaction(async (tx) => {
      const result = await createOnboardingInTransactionImpl(tx, context, input)
      if (result.ok) return result

      // 任一步失敗：記下要回傳的內容，再強制 ROLLBACK（見檔頭）。`tx.rollback()` 之後的程式碼
      // 不會執行到——它的回傳型別是 `never`，`return` 只是滿足這個回呼函式的型別簽章。
      failure = result
      return tx.rollback()
    })
  } catch (error) {
    if (failure !== null) return failure
    // 其餘一律是真正的意外（連不上資料庫、程式錯誤），原樣往上拋，保留堆疊與成因（§3.3）。
    throw error
  }
}
