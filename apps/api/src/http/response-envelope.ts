/**
 * 出口層（§1.8.2）：補上 `rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，並**把訊息 key 翻成字串**。
 *
 * **這五個欄位只有這一層會寫。** 每個欄位只有一個地方寫它，「這個欄位為什麼是這個值」
 * 才會永遠只有一個地方要看；只要有一支 handler 自己填了其中一個，出口層的行為就不再是全站一致的，
 * 而沒有任何方式能從外部看出哪幾支端點自己填了。
 *
 * **翻譯也是同一條規則的延伸，而不是額外的一件事。** envelope 頂層 `msg` 與每一筆 `errors[].msg`
 * 到這一層之前都還是 key（`sessions.main.errors.invalid-credentials`），在這裡才依 `locale` 換成字串——
 * 因為**這是整條鏈上唯一知道 `locale` 的一層**（它就是補 `locale` 的那一層）。
 * 分工是：service／`*.errors.ts` 決定**哪一則訊息**（產出 key），出口層決定**哪一種語言**。
 * 讓 service 決定語言的後果是實的：同一段業務規則被第二種入口（設備、對外 API）呼叫時，
 * 那個入口的語系再也蓋不掉業務層當初挑的那一種（§1.0.1）。
 *
 * 成功與失敗走同一個出口（§1.8.4）：錯誤路徑另開一條的話，錯誤回應會缺 `cmd`／`locale`／`expiresIn`
 * ——前端的統一處理**剛好在最需要它的時候失效**，而且只在出錯時發作，平常測不到。
 * 因此統一 error handler 也呼叫本檔的 {@link finalizeEnvelope}，不自己組（翻譯自然也只有一份）。
 */
import { Elysia } from 'elysia'
import type { Clock } from '../shared/clock.ts'
import type {
  EnvelopeBody,
  ErrorView,
  FinalizedEnvelope,
  TranslatedEnvelopeBody,
  TranslatedErrorView,
} from '../shared/envelope.ts'
import { resolveLocale, translate, type LocaleValue } from '../shared/i18n/messages.ts'
import { WebFlowCode } from '../shared/web-flow-code.ts'
import { requestContext, type RequestSession } from './request-context.ts'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? { ...value } : null

const readString = (record: Record<string, unknown> | null, key: string): string | null => {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * 判斷 handler 的回傳值是不是一包 envelope 前半段。
 *
 * 需要這個判斷，是因為基礎設施端點（`/health`，§1.1）刻意不帶 envelope，
 * 它們的回傳值必須原樣通過出口層。
 */
export const isEnvelopeBody = (value: unknown): value is EnvelopeBody<unknown> => {
  const record = asRecord(value)
  if (record === null) return false
  return typeof record['code'] === 'string' && typeof record['msg'] === 'string' && Array.isArray(record['errors'])
}

/**
 * 把一筆錯誤的 `msg` 由 key 換成字串，並套上該則訊息的插值參數。
 *
 * 逐欄重組而不是展開後覆寫 `msg`：一來 `data` 是選填的（`exactOptionalPropertyTypes`），
 * 展開會把「沒有這個欄位」變成「欄位是 undefined」，那在 JSON 上是兩件事；
 * 二來 `params` **不該出現在回應裡**——它是餵給翻譯的輸入，翻完就沒有用了，
 * 整包展開會把它一起送到瀏覽器。列舉欄位讓「哪些東西會出去」是讀得出來的，而不是推敲出來的。
 */
const translateErrorView = (error: ErrorView, locale: LocaleValue): TranslatedErrorView => {
  const msg = translate(error.msg, locale, error.params)
  return error.data === undefined ? { code: error.code, msg } : { code: error.code, msg, data: error.data }
}

/**
 * 把 envelope 前半段的每一則訊息由 key 換成字串，形狀不動。
 *
 * **逐個 `code` 分支重建，而不是展開後覆寫 `msg`。** 兩個理由：
 * - `msgParams` 必須在這一層被丟掉（翻譯已經套進字串了），而展開會把它一起帶進回應。
 *   分支重建之下，漏掉哪一欄是編譯錯誤，多帶哪一欄也是（{@link TranslatedEnvelopeBody}
 *   的 `msgParams` 是 `never`）。
 * - `EnvelopeBody` 是以 `code` 判別的聯集，`code`／`errors`／`data` 三者的組合互相綁死（§1.3）。
 *   展開的結果在泛型尚未具現時推導不穩定，而分支重建是逐個聯集成員各自寫出來的，永遠成立。
 */
const translateBody = <TData>(body: EnvelopeBody<TData>, locale: LocaleValue): TranslatedEnvelopeBody<TData> => {
  // 空字串是「這次沒有話要說」，不進目錄查詢（見 `shared/envelope.ts` 的 `EnvelopeMessage`）。
  const msg = body.msg === '' ? '' : translate(body.msg, locale, body.msgParams)

  switch (body.code) {
    case WebFlowCode.DataSuccess:
      return { code: body.code, msg, errors: [], data: body.data }
    case WebFlowCode.LogicError:
      // `errors` 的內容仍然由邊界層決定（§1.8.2），這裡只換語言：陣列長度、順序、`code`、`data` 一律不動。
      return {
        code: body.code,
        msg,
        errors: body.errors.map((error) => translateErrorView(error, locale)),
        data: null,
      }
    default:
      // `100`／`400`／`900`／`901`：依 §1.3 一律不帶 errors、不帶 data。
      return { code: body.code, msg, errors: [], data: null }
  }
}

/**
 * 把 envelope 的前半段補成完整回應，並把訊息 key 翻成 `locale` 的字串。
 *
 * @param body handler 或錯誤映射產出的 `code`／`msg`／`errors`／`data`，`msg` 全部還是 key。
 * @param requestBody 原始 request body，用來回聲 `cmd` 與 `locale`。
 * @param session 本次請求的 session；`null` 時 `expiresIn`／`exp` 一律 `null`（§1.3 的 `900` 與公開端點）。
 */
export const finalizeEnvelope = <TData>(
  body: EnvelopeBody<TData>,
  requestBody: unknown,
  session: RequestSession | null,
  clock: Clock,
): FinalizedEnvelope<TData> => {
  const record = asRecord(requestBody)
  // 收斂成支援的語系再翻譯，並且**回聲收斂後的值**：`locale` 這一欄的意義是「這包訊息是哪一種語言」，
  // 原樣回聲一個我們根本沒翻的語系，等於在信封上宣告了一件不成立的事，而前端沒有依據看得出來。
  // 系統只有一種語系時兩者恆等，差別只在錯誤路徑（body 還沒驗過就失敗的那幾種）上看得到。
  const locale = resolveLocale(readString(record, 'locale'))

  // 以 Object.assign 而非物件展開：翻譯後的前半段仍是以 `code` 判別的聯集，泛型尚未具現時
  // 展開結果的推導不穩定，Object.assign 的 `T & U` 簽章則永遠成立
  // ——而 `FinalizedEnvelope` 本來就定義成「前半段 ∩ 後半段」。
  return Object.assign({}, translateBody(body, locale), {
    rspTS: clock.transportNow(),
    // 回聲不到就回空字串而不是省略欄位：前端的統一處理只要遇到「有時有、有時沒有」
    // 就得寫「有就用、沒有就算了」的分支，而那個分支會掩蓋掉真正的漏填。
    cmd: readString(record, 'cmd') ?? '',
    locale,
    expiresIn: session?.renewal.expiresIn ?? null,
    exp: session?.renewal.exp ?? null,
  })
}

/** 出口層 middleware。註冊在所有路由之前，`as: 'global'` 讓它涵蓋每一個群組。 */
export const responseEnvelope = (clock: Clock) =>
  new Elysia({ name: 'response-envelope' }).use(requestContext).onAfterHandle({ as: 'global' }, (context): unknown => {
    const { response } = context
    if (!isEnvelopeBody(response)) return response
    return finalizeEnvelope(response, context.body, context.requestContext.session, clock)
  })
