/**
 * Response envelope 的唯一產出入口（§1.7、§1.8）。
 *
 * 本檔提供兩件成對的東西：
 * - `envelope(dataSchema)`：契約面的 schema 包裝函式，產出 `allOf [BaseResponse, { data }]`。
 * - `ok()` 等執行期產生函式：handler 只回業務資料，由它們包成 envelope 的前半段
 *   （`code`／`msg`／`errors`／`data`），其餘欄位由出口層補（§1.8.2）。
 *
 * **本檔的 `msg` 一律是訊息 key，不是字串**（§1.8.2）：這一層決定「哪一則訊息」，
 * 「哪一種語言」由出口層依 `locale` 決定，因此同一包 envelope 有翻譯前後兩種形狀
 * （{@link EnvelopeBody} 與 {@link TranslatedEnvelopeBody}），中間那一步只發生在出口層。
 *
 * **禁止在 handler 或 routes 內以物件字面值手工組 envelope。** 手工組會漏欄位、會拼錯欄位名、
 * 會忘記在錯誤路徑上也包一層，而這三件事都不會有任何編譯錯誤——TypeScript 只知道你回了一個物件。
 */
import { t } from 'elysia'
import type { Static, TSchema } from '@sinclair/typebox'
import { TransportTS } from './field-schemas.ts'
import { WebFlowCode, type WebFlowCodeValue } from './web-flow-code.ts'
import type { MessageKey, MessageParams } from './i18n/messages.ts'
import type { DomainError, ErrorCode } from './service-result.ts'

/**
 * envelope 頂層 `msg` 的取值：**訊息 key，或空字串**（§1.8.2）。
 *
 * 空字串是「這次沒有話要說」（成功回應的常態），不是漏填——它不進訊息目錄查詢，出口層原樣輸出。
 * 除此之外一律是 key：字串在這裡就寫死了語言，而語言要到出口層讀到 `locale` 才決定得了。
 */
export type EnvelopeMessage = MessageKey | ''

/**
 * 對外揭露的單筆錯誤（§1.3 的 `errors[]`），**`msg` 仍是 key**。
 *
 * 與 {@link DomainError} 分開：`group` 是業務層內部用的分組，不對外。
 * 翻譯不在這裡發生——這一筆會原樣穿過邊界層，由出口層換成該語系的字串（見 {@link TranslatedErrorView}）。
 */
export type ErrorView = {
  readonly code: ErrorCode
  readonly msg: MessageKey
  readonly data?: Record<string, unknown>
  /**
   * 這一則訊息的插值參數，**只送到出口層，不進 JSON 回應**（見 {@link TranslatedErrorView}）。
   *
   * 型別是 {@link MessageParams} 這個聯集而不是 `Record<string, unknown>`：這一層只是搬運，
   * 它不知道手上這筆是哪一個 key，但仍然不該讓任何形狀的物件塞得進來。
   * 真正的「哪個 key 配哪些參數」在 {@link DomainError} 上綁死（見 `service-result.ts`），
   * 也就是**建構那一筆錯誤的地方**——那是唯一知道數字從哪來的地方。
   */
  readonly params?: MessageParams
}

/** 出口層翻譯後的單筆錯誤：`msg` 已經是該語系的字串，這是真正上線的形狀。 */
export type TranslatedErrorView = {
  readonly code: ErrorCode
  readonly msg: string
  readonly data?: Record<string, unknown>
}

export const ErrorItem = t.Object({
  code: t.String({ minLength: 1 }),
  msg: t.String(),
  /** 慣例帶 `field`（dot-path，§1.3），陣列以索引表示：`items.2.startTime`。 */
  data: t.Optional(t.Record(t.String(), t.Unknown())),
})

const WebFlowCodeSchema = t.Union([
  t.Literal(WebFlowCode.DataSuccess),
  t.Literal(WebFlowCode.DataInvalid),
  t.Literal(WebFlowCode.LogicError),
  t.Literal(WebFlowCode.SystemError),
  t.Literal(WebFlowCode.AuthRequired),
  t.Literal(WebFlowCode.PermissionDenied),
])

/**
 * envelope 中與 `data` 無關的欄位。
 *
 * 這裡不含 `data`——`data` 由 {@link envelope} 以泛型帶入，這正是「包裝函式而不是基底類別繼承」的差別：
 * 繼承會讓每支端點多一個只為了掛 `data` 而存在的型別名稱，改 envelope 時要改 N 個子類別而不是一個函式。
 */
export const BaseResponse = t.Object({
  code: WebFlowCodeSchema,
  msg: t.String(),
  /** 僅 `code='300'` 時可非空，其餘一律空陣列（§1.3）。 */
  errors: t.Array(ErrorItem),
  /** 由出口層補上（§1.8.2）。 */
  rspTS: TransportTS,
  cmd: t.String(),
  locale: t.String(),
  /** Session 剩餘秒數，**滑動視窗**；`null` = 本次請求未經 Session 授權。過期判斷的唯一依據。 */
  expiresIn: t.Union([t.Integer(), t.Null()]),
  /** Session 絕對截止時刻。**僅供 log 與除錯**，禁止用於過期判斷、禁止顯示給使用者（§1.3）。 */
  exp: t.Union([TransportTS, t.Null()]),
})

/**
 * 端點的 response schema 產生函式。
 *
 * **這個函式回傳的東西同時扮演兩個角色，而且兩個角色刻意不同形狀：**
 *
 * | 角色 | 內容 | 誰在看 |
 * |---|---|---|
 * | JSON Schema（執行期驗證＋OpenAPI 契約） | **完整** envelope，九個欄位全部必填 | Elysia 的 response 驗證、`bun run gen:api`、前端 |
 * | TypeScript 靜態型別 | {@link EnvelopeBody}：只有 `code`／`msg`／`errors`／`data` | 寫 handler 的人 |
 *
 * 為什麼必須不同：§1.8.2 規定出口層那五欄（`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`）
 * **只有出口層會寫**，handler 一律不得碰。但 Elysia 會拿 `response` schema 的靜態型別去約束
 * handler 的回傳值——直接用完整版的話，「handler 不填那五欄」與「型別檢查要求 handler 填那五欄」
 * 直接對撞，每一支端點都是型別錯誤。而**三種繞法都是在改壞規則本身**：
 * 讓 handler 補那五欄＝廢掉 §1.8.2；在每支端點 `as` 硬轉＝§2.2 明文禁止，且從此再也擋不住
 * 真正回錯形狀的 handler；把那五欄在 schema 上改成選填＝對外契約從「一定有」降級成「可能有」，
 * 前端的統一處理得為每一欄多寫一個「沒有就算了」的分支，而那個分支會掩蓋掉真正的漏填。
 *
 * 因此這裡用 `t.Unsafe` 把「JSON Schema」與「靜態型別」拆開：JSON Schema 原封不動地保留完整
 * envelope（TypeBox 的 `Unsafe` 只換掉 TS 型別，schema 物件本身連同 `Kind` 一起原樣帶過去，
 * 驗證與 OpenAPI 產出完全不受影響），靜態型別則收成 handler 真正該負責的那四欄。
 *
 * **這不是把型別檢查關掉，因為執行期仍然驗完整版。** Elysia 的 response 驗證發生在
 * `onAfterHandle` **之後**、以出口層的產物為對象（見 `elysia/dist/compose.js`：afterHandle 有回傳值時
 * 驗的是那個回傳值）。也就是說：handler 少填的那五欄，如果出口層沒有補上，
 * 這支端點會當場以 response 驗證失敗爆出來，而不是靜靜地回一包缺欄位的 JSON 給前端。
 * 型別上放寬的那五欄，執行期一欄都沒有放寬。
 *
 * @param dataSchema 該端點收窄後的 `data` 形狀。查無資料會回 `null` 的端點請自行包 `Nullable(...)`
 *   ——不在這裡一律加上 `| null`，是因為那會逼「本來就不可能回 null」的端點（例如列表）
 *   在前端也要做一次無意義的空值判斷，久了前端就會養成用非空斷言繞過的習慣。
 */
export const envelope = <TData extends TSchema>(dataSchema: TData) =>
  t.Unsafe<EnvelopeBody<Static<TData>>>(t.Intersect([BaseResponse, t.Object({ data: dataSchema })]))

/**
 * envelope 前半段的形狀，`msg` 與 `errors` 的型別留給呼叫端帶入。
 *
 * 以 `code` 判別的聯集，讓「`code='200'` 卻帶 errors」「`code='300'` 卻沒有 errors」這種
 * 前端無法處置的組合在型別上就寫不出來（§1.3）。
 *
 * 之所以把兩個欄位參數化：翻譯前後是**同一種信封的兩個階段**（key → 字串），寫成兩份各自展開的
 * 聯集之後，日後加一個 `code` 只會有一邊被改到，而兩邊不一致不會有任何錯誤——它們沒有任何
 * 型別關係，只是長得像。
 */
type EnvelopeShape<TData, TMsg, TError, TMsgParams> =
  | {
      readonly code: typeof WebFlowCode.DataSuccess
      readonly msg: TMsg
      readonly msgParams?: TMsgParams
      readonly errors: readonly []
      readonly data: TData
    }
  | {
      readonly code: typeof WebFlowCode.LogicError
      readonly msg: TMsg
      readonly msgParams?: TMsgParams
      readonly errors: readonly TError[]
      readonly data: null
    }
  | {
      readonly code: Exclude<WebFlowCodeValue, typeof WebFlowCode.DataSuccess | typeof WebFlowCode.LogicError>
      readonly msg: TMsg
      readonly msgParams?: TMsgParams
      readonly errors: readonly []
      readonly data: null
    }

/**
 * envelope 的前半段：由 handler／邊界層決定的欄位。
 *
 * **這個階段的 `msg` 全部還是 key**（§1.8.2）：handler、邊界層錯誤映射、統一 error handler
 * 都只決定「哪一則訊息」，沒有任何一層在這裡決定語言。
 */
export type EnvelopeBody<TData> = EnvelopeShape<TData, EnvelopeMessage, ErrorView, MessageParams>

/**
 * 出口層翻譯後的前半段：`msg` 與每一筆 `errors[].msg` 都已換成該語系的字串。
 *
 * `msgParams` 在這個階段是 `never`——插值已經套進字串裡了，參數本身沒有理由再往前走。
 * 在 `exactOptionalPropertyTypes` 之下，`never` 的選填欄位代表「只能整個省略」，
 * 於是**出口層漏刪這個欄位會是編譯錯誤**，而不是靜靜地把內部參數多送一份給瀏覽器。
 */
export type TranslatedEnvelopeBody<TData> = EnvelopeShape<TData, string, TranslatedErrorView, never>

/** envelope 的後半段：只有出口層會寫這些欄位（§1.8.2）。 */
export type EnvelopeTail = {
  readonly rspTS: string
  readonly cmd: string
  readonly locale: string
  readonly expiresIn: number | null
  readonly exp: string | null
}

export type FinalizedEnvelope<TData> = TranslatedEnvelopeBody<TData> & EnvelopeTail

/** 成功。handler 的回傳一律是 `ok(...)`，不得自己組物件。`msg` 省略即空字串（見 {@link EnvelopeMessage}）。 */
export const ok = <TData>(data: TData, msg: EnvelopeMessage = ''): EnvelopeBody<TData> => ({
  code: WebFlowCode.DataSuccess,
  msg,
  errors: [],
  data,
})

/**
 * 業務邏輯錯誤（`300`）。**只有 http 邊界層的錯誤映射會呼叫它**（§1.8.2）：
 * 它要拿到 service 收集到的**整包**錯誤，而不是第一筆。
 */
export const logicError = (
  errors: readonly ErrorView[],
  msg: MessageKey,
  msgParams?: MessageParams,
): EnvelopeBody<null> => ({
  code: WebFlowCode.LogicError,
  msg,
  // 條件展開而不是 `msgParams` 直寫：`exactOptionalPropertyTypes` 之下
  // 「沒有這個欄位」與「欄位是 undefined」是兩件事，後者不符 `msgParams?: MessageParams`。
  ...(msgParams === undefined ? {} : { msgParams }),
  errors,
  data: null,
})

/**
 * 系統錯誤（`400`）。訊息一律一般化：例外訊息可能含 SQL 原文或內部路徑，
 * 對使用者沒有意義，對攻擊者卻有（§3.2）。細節進 log，不進回應。
 */
export const systemError = (msg: MessageKey = 'system.unexpected-error'): EnvelopeBody<null> => ({
  code: WebFlowCode.SystemError,
  msg,
  errors: [],
  data: null,
})

/** 資料不正確（`100`）。依 §1.3 **完全不提供 errors**——送錯代表呼叫端沒照契約來，那是開發期問題。 */
export const dataInvalid = (msg: MessageKey = 'request.invalid-payload'): EnvelopeBody<null> => ({
  code: WebFlowCode.DataInvalid,
  msg,
  errors: [],
  data: null,
})

/** 無有效身分（`900`）。前端據此導向登入頁。 */
export const authRequired = (msg: MessageKey = 'auth.session-required'): EnvelopeBody<null> => ({
  code: WebFlowCode.AuthRequired,
  msg,
  errors: [],
  data: null,
})

/**
 * 有身分但無權限（`901`）。
 *
 * 依 §3.1.1，被拒的細節（是哪一個權限碼、為什麼不通過）**只進 log，不對前端揭露**：
 * 前端對 `901` 的處置本來就只有一種（顯示無權限），而揭露「你是因為不是本人才被擋」
 * 本身就是一種資訊外洩。
 */
export const permissionDenied = (msg: MessageKey = 'auth.permission-denied'): EnvelopeBody<null> => ({
  code: WebFlowCode.PermissionDenied,
  msg,
  errors: [],
  data: null,
})

/**
 * 把業務層的錯誤轉成對外形狀：丟掉只有內部才需要的 `group`。
 *
 * `msg` 與 `params` 原樣帶過去（`msg` 仍是 key）——這裡是邊界層，還不知道 `locale`，
 * **翻譯只發生在出口層**。
 *
 * 逐欄重組＋條件展開而不是 `{ ...error }`：整包展開會把 `group` 一起帶到對外形狀上
 * （那是業務層內部的分組），而 `exactOptionalPropertyTypes` 之下直接寫 `data: error.data`
 * 會把「沒有這個欄位」變成「欄位是 undefined」，那在 JSON 上是兩件事。
 */
export const toErrorView = (error: DomainError): ErrorView => ({
  code: error.code,
  msg: error.msg,
  ...(error.data === undefined ? {} : { data: error.data }),
  ...(error.params === undefined ? {} : { params: error.params }),
})
