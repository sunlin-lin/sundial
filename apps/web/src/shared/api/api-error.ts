/**
 * 統一 client 對外拋出的型別化錯誤（前端規範 §3.3）。
 *
 * 為什麼不讓 `AxiosError` 流出去：畫面上會出現 `Request failed with status code 422`，
 * 對使用者完全不可讀；而且頁面一旦看得到 HTTP status，就會開始自己判斷 `status === 401`，
 * 那正是 §3.6 要擋掉的東西（`901` 被當成 `900` 處理會產生登入無限迴圈）。
 *
 * 四個類別對應 §3.6 的四種前端動作，**不是**四種伺服器狀態：
 * 業務訊息／導登入／顯示無權限／進錯誤回報。
 */
import type { EnvelopeError } from './envelope.ts'

/**
 * `code='300'`：業務規則不允許。
 *
 * `errors` 逐筆帶著 `data.field`（dot-path），畫面要依路徑定位到「該列該格」（§6.3）。
 */
export class BusinessRuleError extends Error {
  readonly errors: readonly EnvelopeError[]

  constructor(message: string, errors: readonly EnvelopeError[]) {
    super(message)
    this.name = 'BusinessRuleError'
    this.errors = errors
  }
}

/**
 * `code='900'`：沒有有效身分。
 *
 * client 在拋出這個錯誤之前，已經清掉記憶體中的 access token 並通知導向登入頁。
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

/**
 * `code='901'`：有身分但沒有權限。
 *
 * **絕對不可以被當成 `AuthRequiredError` 處理。** 把 403 當 401 導向登入頁，
 * 使用者會進入「登入 → 點到沒權限的功能 → 被踢回登入頁 → 登入 → 又被踢回」的無限迴圈，
 * 而他每重登一次就再遇到一次（§3.6）。
 */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * `code='100'`／`'400'`、以及任何不是 envelope 的回應：一律當系統錯誤。
 *
 * `100` 代表呼叫端沒照契約送資料，那是我們的 bug——後端在 `100` 時不提供 `errors`，
 * 前端也沒有東西可以顯示給使用者。**細節一律不對使用者顯示**，只進錯誤回報（§3.6）。
 */
export class SystemFailureError extends Error {
  /** 收到的 envelope `code`，或在回應不是 envelope 時記下 HTTP status。僅供錯誤回報。 */
  readonly diagnosticCode: string

  /**
   * envelope 的 `exp`，**唯一用途是寫進錯誤回報與 log**（§3.7）。
   *
   * 命名帶上 `ForLog` 是刻意的：它不得用於任何過期判斷（那一律走 `expiresIn` 算出的 deadline），
   * 也不得出現在任何顯示路徑上——它是帶時區偏移的字串，上畫面就會被裝置時區再換算一次。
   */
  readonly expForLog: string | null

  constructor(message: string, diagnosticCode: string, expForLog: string | null) {
    super(message)
    this.name = 'SystemFailureError'
    this.diagnosticCode = diagnosticCode
    this.expForLog = expForLog
  }
}
