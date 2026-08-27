/**
 * 業務錯誤的「收集」模型（§3.1.1）。
 *
 * service 偵測到業務規則不符時把錯誤累積起來、全部檢查跑完才回傳，**不以拋例外表達業務拒絕**。
 * 上游是各模組的 service，下游是 http 邊界層的錯誤映射；本檔不得依賴任何 http 或 elysia 模組
 * ——那正是「同一段業務規則可以被第二種入口呼叫」的支點（§1.0.1）。
 */
import type { ErrorCode, MessageParamsOf, ParameterizedMessageKey } from './i18n/messages.ts'

/**
 * 錯誤分組。
 *
 * 刻意用具名常數而不是 HTTP 數字：「這個分組在某個入口上對應什麼狀態碼」是**入口的事**，
 * 不是業務層的事。寫成 409／422 之後，這段規則就只能被 Web 前端這一種入口呼叫。
 */
export const ErrorGroup = {
  Conflict: 'conflict',
  Unprocessable: 'unprocessable',
  Forbidden: 'forbidden',
} as const

export type ErrorGroupValue = (typeof ErrorGroup)[keyof typeof ErrorGroup]

/**
 * 錯誤碼（§1.3），格式 `<領域>.<原因>`，例如 `auth.invalid-credentials`。
 *
 * **它是一份集中的字面值聯集，不是 `` `${string}.${string}` `` 樣板型別。** 聯集列在
 * `shared/i18n/messages.ts`——因為錯誤碼與訊息 key 刻意是同一個字串，「有哪些碼」與「每個碼講哪句話」
 * 就只有一份清單，不必再維護第二份對照。從這裡 re-export 是為了讓呼叫端不必知道這件事：
 * 業務層要的是「錯誤碼」這個概念，它落在錯誤收集模型上，不落在訊息目錄上。
 */
export type { ErrorCode }

/**
 * 這個錯誤碼的訊息要不要插值參數。
 *
 * **兩種寫法各擋一半：** 需要插值的碼上 `params` 是**必填**，於是「訊息裡留著一串
 * `{{assignedUserCount}}`」在建構那一筆錯誤的地方就寫不出來——而那正是唯一知道數字從哪來的地方。
 * 不需插值的碼上 `params?: never`（`exactOptionalPropertyTypes` 之下只能整個省略），
 * 於是也不會有人「順手」多塞一包沒有任何一則訊息會用到的變數進來。
 */
type DomainErrorParamsOf<TCode extends ErrorCode> = TCode extends ParameterizedMessageKey
  ? { readonly params: MessageParamsOf<TCode> }
  : { readonly params?: never }

/**
 * 單筆業務錯誤（以錯誤碼展開的聯集）。
 *
 * **`msg` 是訊息 key 而不是字串，而且型別上被綁死等於 `code`。** 兩件事各擋一種失敗：
 * - 帶 key 不帶字串：service 決定「哪一則訊息」，語言由出口層依 `locale` 決定（§1.8.2）。
 *   業務層一旦寫死中文，這段規則被第二種入口呼叫時就改不掉語系了（§1.0.1）。
 * - `msg` 只能填自己的 `code`：寫成別的碼不會有任何錯誤，只會讓使用者看到一句**對不上這個錯誤**
 *   的訊息（`role.not-found` 配上「仍有公司成員使用此角色」），而 `errors[].code` 是對的，
 *   所以前端的分支也是對的——沒有任何一層會察覺。展開成聯集之後，這種寫法直接編譯不過。
 *
 * **`params` 與 `data` 是兩件事，刻意不共用一個欄位。** `data` 是回給前端的（`field` dot-path、
 * 統計數字），`params` 只餵給出口層的翻譯。同一個數字兩邊都出現是正常的——前端要它來定位欄位，
 * 訊息要它來造句；合併成一個欄位的話，「哪些東西會被送到瀏覽器」就得逐則訊息去推敲，
 * 而 §3.2 對 `errors[].data` 有明文限制（禁止放敏感值），那條限制需要一個看得見邊界的欄位。
 */
type DomainErrorOf<TCode extends ErrorCode> = {
  readonly group: ErrorGroupValue
  readonly code: TCode
  readonly msg: TCode
  /** 慣例帶 `field`（dot-path，§1.3），例如 `items.2.startTime`；禁止放敏感值（§3.2）。 */
  readonly data?: Record<string, unknown>
} & DomainErrorParamsOf<TCode>

export type DomainError = { readonly [TCode in ErrorCode]: DomainErrorOf<TCode> }[ErrorCode]

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DomainError[] }

export const succeed = <T>(value: T): ServiceResult<T> => ({ ok: true, value })

/**
 * 失敗結果。
 *
 * 參數是「整包錯誤」而不是單筆，形狀上就逼呼叫端先把檢查跑完再回傳——收一筆的簽章
 * 會讓「第一筆就 return」變成最順手的寫法，而那正是 §3.1.1 要防的事：`errors` 陣列
 * 從此永遠只裝得下一個元素，前端為多筆錯誤寫的定位邏輯等於白寫。
 */
export const fail = (errors: readonly DomainError[]): ServiceResult<never> => ({ ok: false, errors })
