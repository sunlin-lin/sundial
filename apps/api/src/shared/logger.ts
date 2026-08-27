/**
 * 結構化 log 的唯一出口。
 *
 * 全專案只有本檔可以呼叫 `console`（ESLint 的 `no-console` 對其餘檔案一律 error）：
 * 散落各處的 `console.log` 會把個資或薪資印到 stdout，而 log 的保存期就此變成個資保存期。
 * 集中之後，欄位遮罩與輸出目的地只有一個地方要改。
 *
 * TODO(接上正式的 log 收集器時): 目前直接寫 stdout。改用結構化 logger 時，
 * 要一併補上敏感欄位遮罩（§5.1：密碼、hash、完整身分證、銀行帳號、加密金鑰、SQL 原文一律不得進 log）。
 */

/** §1.3 要求的 log 分類。404 與 500 在前端都是 `'400'`，這個差別只能靠 log 補回來。 */
export const LogCategory = {
  RouteNotFound: 'route_not_found',
  UnhandledException: 'unhandled_exception',
  UpstreamTimeout: 'upstream_timeout',
  PermissionDenied: 'permission_denied',
  Startup: 'startup',
  /**
   * 系統自己偵測到的安全事件（§5.4.2 的 refresh token 偷用偵測，日後的帳號鎖定亦同）。
   *
   * **必須與 `unhandled_exception` 分開，不能借用。** 兩者的告警處置完全不同：例外要找 bug，
   * 安全事件要通知人、要看是不是同一個帳號連續發生。混在同一類之後，
   * 「本系統少數幾個自己能發現的安全訊號」會被淹沒在一堆程式錯誤裡，
   * 而 §5.4.2 說得很清楚：靜靜作廢等於浪費了這個訊號。
   */
  SecurityEvent: 'security_event',
} as const

export type LogCategoryValue = (typeof LogCategory)[keyof typeof LogCategory]

export type LogFields = Record<string, unknown>

const write = (level: 'info' | 'warn' | 'error', category: LogCategoryValue, message: string, fields: LogFields) => {
  const line = JSON.stringify({ level, category, message, ...fields })
  // eslint-disable-next-line no-console -- 本檔是全站唯一的 log 出口，見檔首說明
  console[level](line)
}

export const logger = {
  info: (category: LogCategoryValue, message: string, fields: LogFields = {}) => write('info', category, message, fields),
  warn: (category: LogCategoryValue, message: string, fields: LogFields = {}) => write('warn', category, message, fields),
  error: (category: LogCategoryValue, message: string, fields: LogFields = {}) =>
    write('error', category, message, fields),
}
