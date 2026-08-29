/**
 * 公司帳號成員關係的錯誤字典（§0.4「errors 不拆」）。
 *
 * `createCompanyUserInTransaction` 沒有自己的端點（唯一呼叫者是 `employees/onboarding`，
 * 見 `company-users-main.service.ts` 檔頭），它的錯誤碼會被那個端點的 `errors.ts` 收進自己的
 * 宣告清單。**`resetCompanyUserPassword` 不同：本輪起有自己的端點**
 * （`/company-users/main/reset-password`，UI 定案 `docs/ui/20-employee-list.md` §3.5），
 * 因此下面補了一個依端點分組的錯誤碼陣列，形狀比照 `company-users/roles` 的
 * `COMPANY_USERS_ROLES_*_ERROR_CODES`（同一個大目錄，同一套慣例）。
 *
 * 碼本身依 §1.3 的規則由**本模組**的路徑推導（`company-users.main.errors.*`），不是
 * `employees.onboarding.errors.*`——這條規則產生這個業務拒絕，訊息的所有權留在這裡，
 * 呼叫者只是轉手回傳，理由與 `audit` 模組的動作碼「沒有端點也一樣有前兩段」同構。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type DomainError, type ErrorCode } from '../../../shared/service-result.ts'

export const CompanyUserErrorCode = {
  UsernameTaken: 'company-users.main.errors.username-taken',
  /**
   * 422。查無此公司成員——**包含「屬於其他公司」**（§3.2），理由與
   * `company-users/roles` 的同名錯誤同構：兩者走的是同一行程式碼（`company_id` 寫在
   * `WHERE` 裡），想寫出不一致的回應都寫不出來。
   */
  CompanyUserNotFound: 'company-users.main.errors.company-user-not-found',
  /**
   * 409。操作者對自己的帳號送出啟用／停用（本輪新增，UI 定案 `docs/ui/20-employee-list.md`
   * §3.5「管理登入帳號狀態」）。**分組是 `Conflict`，不是 `Forbidden`**——理由見
   * `impl/company-users-main.deactivate-account.service.ts` 檔頭：`Forbidden` 在邊界層固定
   * 映射成不帶 `errors[]` 的通用「權限不足」（`http/error-boundary.ts`），前端會拿不到可以顯示
   * 的具體訊息；這裡要的是使用者看得懂、可以定位到 `employeeId` 欄位的拒絕，因此比照
   * `company-users/roles` 的 `lastRoleRequired`，用 `Conflict` 表達「這個操作與系統的一項不變量
   * 衝突」，不是「你沒有這個功能權限」。
   */
  CannotChangeOwnAccountStatus: 'company-users.main.errors.cannot-change-own-status',
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

/**
 * 查無此公司成員，見上方 {@link CompanyUserErrorCode.CompanyUserNotFound} 檔頭。
 *
 * @param field 請求裡指向這個目標的欄位名（§1.3 的 `data.field` 慣例）。**預設 `companyUserId`**
 *   保留重設密碼原本的行為不變；啟用／停用端點的請求以 `employeeId` 指定目標（理由見
 *   `impl/company-users-main.deactivate-account.service.ts` 檔頭），呼叫時要明確傳入。
 */
export const companyUserNotFound = (field: 'companyUserId' | 'employeeId' = 'companyUserId'): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: CompanyUserErrorCode.CompanyUserNotFound,
  msg: CompanyUserErrorCode.CompanyUserNotFound,
  data: { field },
})

/**
 * 操作者對自己的帳號送出啟用／停用，見上方 {@link CompanyUserErrorCode.CannotChangeOwnAccountStatus}
 * 檔頭。啟用／停用共用同一個碼——對使用者而言都是「不能對自己的帳號做這件事」，沒有必要為兩個
 * 方向各造一個字面上不同、語意卻相同的碼。
 */
export const cannotChangeOwnAccountStatus = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: CompanyUserErrorCode.CannotChangeOwnAccountStatus,
  msg: CompanyUserErrorCode.CannotChangeOwnAccountStatus,
  data: { field: 'employeeId' },
})

/** `POST /company-users/main/reset-password` 可能吐出的業務錯誤碼（§1.8.3）。 */
export const COMPANY_USERS_MAIN_RESET_PASSWORD_ERROR_CODES: readonly ErrorCode[] = [
  CompanyUserErrorCode.CompanyUserNotFound,
]

/** `POST /company-users/main/activate` 可能吐出的業務錯誤碼（§1.8.3）。 */
export const COMPANY_USERS_MAIN_ACTIVATE_ERROR_CODES: readonly ErrorCode[] = [
  CompanyUserErrorCode.CompanyUserNotFound,
  CompanyUserErrorCode.CannotChangeOwnAccountStatus,
]

/** `POST /company-users/main/deactivate` 可能吐出的業務錯誤碼（§1.8.3）。 */
export const COMPANY_USERS_MAIN_DEACTIVATE_ERROR_CODES: readonly ErrorCode[] = [
  CompanyUserErrorCode.CompanyUserNotFound,
  CompanyUserErrorCode.CannotChangeOwnAccountStatus,
]
