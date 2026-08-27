/**
 * 共用欄位型別（§2）。
 *
 * 集中定義的理由是**限制值本身**：同一個「原因」欄位在 A 端點寫 `maxLength: 500`、
 * 在 B 端點寫 200、在 C 端點忘了寫上限，結果是使用者在某個畫面填得下的字數，
 * 在另一個畫面送出後被退回；而沒有上限的那一支，一段 10MB 的字串就能塞爆稽核紀錄。
 *
 * 端點一律引用本檔，禁止就地重寫 `t.String({ maxLength: ... })`。
 */
import { t } from 'elysia'
import type { TSchema } from '@sinclair/typebox'
import { SUPPORTED_LOCALES } from './i18n/messages.ts'

/** UUID v1–v5 的字面格式。用 pattern 而非 `format: 'uuid'`，避免相依 TypeBox 的 format 註冊時機。 */
export const Uuid = t.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
})

/** 業務日期 `YYYY-MM-DD`，台北的日曆日，不帶任何時區標記（§6.1）。 */
export const IsoDate = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

/**
 * 業務時間 `YYYY-MM-DD HH:mm:ss`，台北牆鐘時間，**刻意不帶時區標記**（§6.1）。
 *
 * 帶了標記之後，前端 `new Date('...+08:00')` 會依**瀏覽器**時區再換算一次並顯示換算後的結果
 * ——使用者把筆電時區設成東京，整批時間就多一小時，而系統任何一處都不會報錯。
 */
export const TaipeiDateTime = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' })

/**
 * 傳輸層時戳，ISO 8601 帶時區偏移（`2026-04-14T14:30:00+08:00`）。
 *
 * **只有 `rqTS`／`rspTS`／`exp` 三欄可以用它**，且三者一律不上畫面、不得當業務時間計算（§6.1）。
 * 與 {@link TaipeiDateTime} 型別上分開，是為了讓「拿傳輸時戳當事件發生時刻」寫不出來
 * ——`rqTS` 是請求發出的時刻，在網路重試或前端排隊時與業務事件差好幾秒。
 */
export const TransportTS = t.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?[+-]\\d{2}:\\d{2}$',
})

/** 月份 `YYYY-MM`（§6.1）。 */
export const YearMonth = t.String({ pattern: '^\\d{4}-(?:0[1-9]|1[0-2])$' })

/** 原因欄位。上限 500 是全站唯一值，需要調整時改這裡而不是在端點放寬。 */
export const Reason = t.String({ minLength: 1, maxLength: 500 })

/**
 * 金額。**以 decimal 字串傳輸，不是 number**（§4.7）：JS number 是浮點數，
 * 誤差在薪資單上就是實發金額差一塊錢對不起來，而勞健保級距在邊界值上會選錯級距。
 * 整數部分放到 13 位（兆級），小數兩位。
 */
export const Money = t.String({ pattern: '^-?\\d{1,13}(?:\\.\\d{1,2})?$' })

/**
 * 時間長度，一律以**整數分鐘**表示（§4.7）。用小數小時（8.33）做加總，
 * 月結時會累積出數十分鐘誤差。跨午夜的時刻另以「當日第幾分鐘」表示，允許超過 1440。
 */
export const Minutes = t.Integer({ minimum: 0 })

/**
 * 語系。目前只有繁體中文；新增語系是相容變更（新增列舉值且舊值仍支援，§1.6）。
 *
 * **由訊息目錄的支援清單推導，不在這裡另寫一份字面值。** 兩處各寫一份的結果是它們會分岔：
 * schema 放行了一個目錄裡沒有的語系（整批訊息靜靜回落成中文），或目錄翻好了卻被 schema 擋在門外
 * ——兩種都不會有任何編譯錯誤。
 */
export const Locale = t.Union(SUPPORTED_LOCALES.map((locale) => t.Literal(locale)))

/**
 * Request 的三個基底欄位（§1.3），**平鋪**在 body 同一層，不另開 `payload` 巢狀節點。
 *
 * 這是一個可展開的物件而不是 `t.Object`，因為端點要寫成 `t.Object({ ...BaseRequest, keyword })`
 * ——巢狀之後每支端點都要決定「這個欄位算基底還是業務」，前端就無法用同一個包裝函式送請求。
 *
 * 端點**必須把 `cmd` 收窄成該端點的字面值**（`t.Literal('roles.main.list')`），
 * 值由 `toCommandCode()` 的規則推導，不得手寫成別的字串。
 */
export const BaseRequest = {
  rqTS: TransportTS,
  cmd: t.String({ minLength: 1 }),
  locale: Locale,
} as const

/**
 * 分頁請求欄位（§1.4），平鋪在 body。
 *
 * 名稱固定為 `perPage`／`currentPage`：禁止在不同端點改叫 `page`、`size`、`limit`、`offset`，
 * 否則前端無法用同一套規則呼叫列表端點。上限 100 是為了擋掉無上限查詢
 * ——不設限的按月查詢在中型客戶就是數萬列，一次撈完會打爆記憶體並拖垮連線池。
 */
export const PageRequest = {
  perPage: t.Integer({ minimum: 1, maximum: 100, default: 20 }),
  currentPage: t.Integer({ minimum: 1, default: 1 }),
} as const

export const SortOrder = t.Union([t.Literal('asc'), t.Literal('desc')])

/**
 * 排序請求（§1.4）。不支援多欄排序。
 *
 * **列表端點應改用 {@link sortRequest} 帶入白名單**：把字串直接接進 SQL 等於開放
 * SQL injection 與全表掃描。本常數只供不需限制欄位的內部用途與型別參照。
 */
export const SortRequest = t.Object({ field: t.String({ minLength: 1 }), order: SortOrder })

/**
 * 帶欄位白名單的排序請求。
 *
 * @param allowedFields 允許排序的欄位名（camelCase，對應 API 對外欄位而非 DB 欄位）。
 */
export const sortRequest = <const TFields extends readonly string[]>(allowedFields: TFields) =>
  t.Object({
    field: t.Union(allowedFields.map((field) => t.Literal(field))),
    order: SortOrder,
  })

/**
 * 分頁資訊。**刻意不提供總頁數**（§1.4）：兩個數字並存時只要有一邊算錯，
 * 就會出現「共 137 筆、14 頁」但只有 13 頁可點的狀況，而前端沒有依據判斷該信哪一個。
 */
export const Pagination = t.Object({
  currentPage: t.Integer({ minimum: 1 }),
  perPage: t.Integer({ minimum: 1 }),
  totalCount: t.Integer({ minimum: 0 }),
})

/**
 * 列表端點的 `data` 形狀（§1.4）：實際清單在 `data.data`。
 *
 * `search` 與 `sort` **必須原樣回聲**，不是多餘欄位：使用者快速切換篩選條件時會連續送出多次查詢，
 * 而回應到達順序不保證。回聲值讓前端能比對「這包回應是不是我現在畫面上這組條件的結果」，
 * 不是的就丟掉；沒有它，較慢的舊回應會蓋掉較新的，而且沒有任何錯誤。
 *
 * @param searchSchema 該端點的搜尋條件形狀，用於回聲。
 * @param itemSchema 清單單筆的形狀。
 */
export const paginationResponse = <TSearch extends TSchema, TItem extends TSchema>(
  searchSchema: TSearch,
  itemSchema: TItem,
) =>
  t.Object({
    search: searchSchema,
    sort: SortRequest,
    pagination: Pagination,
    data: t.Array(itemSchema),
  })

/** `T | null`。查無資料時 `data` 為 `null`（§1.3），因此單筆查詢端點的 `data` 要包這一層。 */
export const Nullable = <TInner extends TSchema>(schema: TInner) => t.Union([schema, t.Null()])
