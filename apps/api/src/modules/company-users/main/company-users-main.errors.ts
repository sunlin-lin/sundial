/**
 * 公司帳號成員關係的錯誤字典（§0.4「errors 不拆」）。
 *
 * **本次目錄沒有自己的端點**（見 `company-users-main.service.ts` 檔頭），因此這裡沒有
 * `ENDPOINT_ERRORS` 這種依端點分組的宣告表——`createCompanyUserInTransaction` 目前唯一的呼叫者
 * 是 `employees/onboarding`，它的錯誤碼會被那個端點的 `errors.ts` 收進自己的宣告清單。
 * 碼本身仍然依 §1.3 的規則由**本模組**的路徑推導（`company-users.main.errors.*`），不是
 * `employees.onboarding.errors.*`——這條規則產生這個業務拒絕，訊息的所有權留在這裡，
 * 呼叫者只是轉手回傳，理由與 `audit` 模組的動作碼「沒有端點也一樣有前兩段」同構。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type DomainError, type ErrorCode } from '../../../shared/service-result.ts'

export const CompanyUserErrorCode = {
  UsernameTaken: 'company-users.main.errors.username-taken',
} as const satisfies Record<string, ErrorCode>

export type CompanyUserErrorCodeValue = (typeof CompanyUserErrorCode)[keyof typeof CompanyUserErrorCode]

/**
 * 登入帳號重複（`users.username` 全域唯一，實作計畫 `05-employee-onboarding.md`
 * 「二、`username` 全域唯一造成的跨租戶問題」定案）。
 *
 * **訊息刻意含糊，不透露這個帳號屬於哪一家公司**（§3.2）：`username` 全域唯一，A 公司填的帳號
 * 可能已經被 B 公司的員工用走。若訊息透露「這個帳號已存在（不論哪家公司）」以外的任何資訊
 * ——例如它現在屬於哪家公司、是不是有效——A 公司的建立者就能拿建立表單當成一支跨公司帳號枚舉
 * 端點使用。分組是 `Conflict`（→ 409）：使用者的處置是換一個帳號，不是重填整張表。
 *
 * **絕對不做的事**（定案，不是待辦）：偵測到重複之後，**不**查詢、**不**回傳、**更不**更新
 * 那個既有 `users` 列的任何欄位。連結既有帳號看起來合理（「同一個人在兩家公司任職」），但系統
 * 無法驗證那是不是同一個人；跨公司共用同一個登入身分必須是一條刻意的、雙方都同意的流程
 * （邀請／接受），不能是新增員工的副作用。
 */
export const usernameTaken = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: CompanyUserErrorCode.UsernameTaken,
  msg: CompanyUserErrorCode.UsernameTaken,
  data: { field: 'username' },
})
