/**
 * Response envelope 的解析（後端規範 §1.3）。
 *
 * **只有統一 client 會用到這個檔案。** 頁面拿到的永遠是 `data`，碰不到 `rspTS`／`cmd`／`locale`／
 * `msg`（前端規範 §3.1）——所以下面解析出來的形狀刻意**不含** `rspTS`／`cmd`／`locale`：
 * 沒有被解析出來的欄位，就沒有機會被誰「順手」帶到畫面上。`rspTS` 是帶時區偏移的字串，
 * 一旦上畫面就會被瀏覽器依裝置時區再換算一次（前端規範 §9.2）。
 */
import { isRecord } from './record-shape.ts'

/**
 * 六個 `code`（後端規範 §1.3）。
 *
 * 分類軸是「前端拿到之後該做什麼」，不是 HTTP 語意——所以只有六條路，
 * 而且這六條路只在統一 client 內走一次（前端規範 §3.6）。
 */
export const WEB_FLOW_CODE = {
  DataSuccess: '200',
  DataInvalid: '100',
  LogicError: '300',
  SystemError: '400',
  AuthRequired: '900',
  PermissionDenied: '901',
} as const

export type WebFlowCode = (typeof WEB_FLOW_CODE)[keyof typeof WEB_FLOW_CODE]

/** `errors[]` 的單筆結構（後端規範 §1.3）。僅 `code='300'` 時會有內容。 */
export type EnvelopeError = {
  /** 語意化錯誤碼，例如 `auth.invalid-credentials`。前端據此決定行為。 */
  readonly code: string
  /** 錯誤訊息。前端只拿它當 fallback 顯示，不拿它做判斷。 */
  readonly msg: string
  /**
   * 該錯誤的細節。慣例帶 `field`（dot-path，例如 `items.2.startTime`）指出出錯位置，
   * 定位規則見前端規範 §6.3。
   */
  readonly data: Readonly<Record<string, unknown>>
}

/** 解析後的 envelope。刻意是原始 envelope 的**子集**，理由見檔頭。 */
export type ResponseEnvelope = {
  readonly code: string
  readonly msg: string
  readonly errors: readonly EnvelopeError[]
  readonly data: unknown
  /** access token 剩餘秒數。`null` 表示本次回應之後手上沒有有效的 access token。 */
  readonly expiresIn: number | null
  /** 絕對截止時刻。**唯一用途是寫進 log 與錯誤回報**（前端規範 §3.7），不得用於過期判斷或顯示。 */
  readonly exp: string | null
}

const toEnvelopeError = (raw: unknown): EnvelopeError | null => {
  if (!isRecord(raw)) return null
  const code = raw['code']
  const msg = raw['msg']
  const data = raw['data']
  if (typeof code !== 'string' || typeof msg !== 'string') return null
  return { code, msg, data: isRecord(data) ? data : {} }
}

/**
 * 把 HTTP 回應的 body 收斂成 `ResponseEnvelope`，形狀不符即回 `null`。
 *
 * 外部邊界一律先當 `unknown`、驗證過才進業務邏輯（通用規範 §2.2）。回 `null` 而不是丟例外，
 * 是因為「後端回了一包不是 envelope 的東西」與「後端回了一個業務錯誤」是兩件事：
 * 前者一律當系統錯誤（多半是打到了 proxy 的錯誤頁或部署不同步），由呼叫端決定怎麼回報。
 */
export const parseResponseEnvelope = (payload: unknown): ResponseEnvelope | null => {
  if (!isRecord(payload)) return null

  const code = payload['code']
  const msg = payload['msg']
  const rawErrors = payload['errors']
  const expiresIn = payload['expiresIn'] ?? null
  const exp = payload['exp'] ?? null

  if (typeof code !== 'string') return null
  if (typeof msg !== 'string') return null
  if (!Array.isArray(rawErrors)) return null
  if (expiresIn !== null && typeof expiresIn !== 'number') return null
  if (exp !== null && typeof exp !== 'string') return null

  const errors = rawErrors
    .map(toEnvelopeError)
    .filter((error): error is EnvelopeError => error !== null)

  return { code, msg, errors, data: payload['data'] ?? null, expiresIn, exp }
}
