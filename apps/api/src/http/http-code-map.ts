/**
 * HTTP status 與 envelope `code` 的映射（§1.3）。
 *
 * 這張表的分類軸**不是 HTTP 語意，而是「前端拿到之後該做什麼」**：六個 `code` 對應六種前端動作，
 * 因此多個 status 會映到同一個 code（404 與 500 都是 `'400'`，409 與 422 都是 `'300'`）
 * ——因為前端對它們該做的事一模一樣。反過來說，只要前端該做的事不同，`code` 就必須不同。
 */
import { WebFlowCode, type WebFlowCodeValue } from '../shared/web-flow-code.ts'

/**
 * 本系統使用的 HTTP status。
 *
 * **201、202、429、423 刻意不在列上**：建立成功回 200 不回 201。多一個狀態碼就多一個
 * 前端要分辨的分支，而它們對應的前端動作與 200 完全相同。
 */
export const HttpStatus = {
  Ok: 200,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  UnprocessableEntity: 422,
  InternalServerError: 500,
} as const

export type HttpStatusValue = (typeof HttpStatus)[keyof typeof HttpStatus]

/**
 * §1.3 的映射表。
 *
 * 反方向（`code` → status）刻意不提供：那是**一對多**，硬做出來的函式一定要在某處猜
 * 「這個 `300` 該回 409 還是 422」，而那個判斷屬於邊界層的錯誤映射（依錯誤分組決定，
 * 見 `error-boundary.ts`），不屬於一張查表。
 */
export const WEB_FLOW_CODE_BY_HTTP_STATUS: Readonly<Record<HttpStatusValue, WebFlowCodeValue>> = {
  [HttpStatus.Ok]: WebFlowCode.DataSuccess, // 正常
  [HttpStatus.BadRequest]: WebFlowCode.DataInvalid, // 資料不正確 → 前端進錯誤回報（代表呼叫端 bug）
  [HttpStatus.Unauthorized]: WebFlowCode.AuthRequired, // 無有效身分 → 導向登入頁
  [HttpStatus.Forbidden]: WebFlowCode.PermissionDenied, // 無權限 → 顯示無權限，不可導登入頁
  [HttpStatus.NotFound]: WebFlowCode.SystemError, // 端點不存在（前後端部署不同步）→ 顯示系統錯誤
  [HttpStatus.Conflict]: WebFlowCode.LogicError, // 邏輯錯誤 → 顯示業務訊息，讀 errors
  [HttpStatus.UnprocessableEntity]: WebFlowCode.LogicError, // 同上
  [HttpStatus.InternalServerError]: WebFlowCode.SystemError, // 系統錯誤
}
