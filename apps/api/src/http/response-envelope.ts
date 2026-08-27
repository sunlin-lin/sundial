/**
 * 出口層（§1.8.2）：補上 `rspTS`／`cmd`／`locale`／`expiresIn`／`exp`。
 *
 * **這五個欄位只有這一層會寫。** 每個欄位只有一個地方寫它，「這個欄位為什麼是這個值」
 * 才會永遠只有一個地方要看；只要有一支 handler 自己填了其中一個，出口層的行為就不再是全站一致的，
 * 而沒有任何方式能從外部看出哪幾支端點自己填了。
 *
 * 成功與失敗走同一個出口（§1.8.4）：錯誤路徑另開一條的話，錯誤回應會缺 `cmd`／`locale`／`expiresIn`
 * ——前端的統一處理**剛好在最需要它的時候失效**，而且只在出錯時發作，平常測不到。
 * 因此統一 error handler 也呼叫本檔的 {@link finalizeEnvelope}，不自己組。
 */
import { Elysia } from 'elysia'
import type { Clock } from '../shared/clock.ts'
import type { EnvelopeBody, FinalizedEnvelope } from '../shared/envelope.ts'
import { requestContext, type RequestSession } from './request-context.ts'

/** 回聲不到 `locale` 時的預設值。目前系統只有一種語系（§2 的 `Locale`）。 */
const DEFAULT_LOCALE = 'zh-TW'

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
 * 把 envelope 的前半段補成完整回應。
 *
 * @param body handler 或錯誤映射產出的 `code`／`msg`／`errors`／`data`。
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
  // 以 Object.assign 而非物件展開：`body` 是以 `code` 判別的聯集，泛型尚未具現時
  // 展開結果的推導不穩定，Object.assign 的 `T & U` 簽章則永遠成立。
  return Object.assign({}, body, {
    rspTS: clock.transportNow(),
    // 回聲不到就回空字串而不是省略欄位：前端的統一處理只要遇到「有時有、有時沒有」
    // 就得寫「有就用、沒有就算了」的分支，而那個分支會掩蓋掉真正的漏填。
    cmd: readString(record, 'cmd') ?? '',
    locale: readString(record, 'locale') ?? DEFAULT_LOCALE,
    expiresIn: session?.renewal.expiresIn ?? null,
    exp: session?.renewal.exp ?? null,
  })
}

/** 出口層 middleware。註冊在所有路由之前，`as: 'global'` 讓它涵蓋每一個群組。 */
export const responseEnvelope = (clock: Clock) =>
  new Elysia({ name: 'response-envelope' })
    .use(requestContext)
    .onAfterHandle({ as: 'global' }, (context): unknown => {
      const { response } = context
      if (!isEnvelopeBody(response)) return response
      return finalizeEnvelope(response, context.body, context.requestContext.session, clock)
    })
