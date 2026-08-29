/**
 * 日偏移的文字化（前端規範必做事項 2；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * 跨日班的 `endDayOffset=1` 直接顯示數字沒有人看得懂，畫面上要呈現成「隔日 06:00」這種形式。
 * 休息的起訖各有日偏移（計畫 §4.2 的唯一增補），因此本檔的函式同時服務工作時段與休息時段——
 * 兩者都是「一個時刻 + 一個日偏移」，呈現規則完全相同，不必各寫一份。
 *
 * **`offset` 的型別是 `string | number`**：後端的 `t.Integer()` 在 OpenAPI 上留下 `anyOf` 的影子
 * （同 `regulatory-sync.view.ts` 檔頭提過的那個問題），值只會是 `0` 或 `1`（`ShiftDayOffset` 的
 * `minimum`／`maximum`），因此**不需要解析成數字**——直接比對字面文字就能判斷是不是隔日，
 * 比呼叫任何數值轉型函式都直接（也順帶避開 `check:number-cast` 完全不需要的一次轉型）。
 */
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 後端 `ShiftDayOffset` 的合法值只有 `0`／`1`（含字串或數字兩種型態）。 */
export type DayOffsetValue = string | number

/** 是否為隔日。`String(...)` 是顯示方向的型別收斂，不是數值轉型，不受 `check:number-cast` 規範。 */
export const isNextDay = (offset: DayOffsetValue): boolean => String(offset) === '1'

/** 隔日前綴，含後面的空白；當日時是空字串（呼叫端不必再處理有無空白的差異）。 */
export const dayOffsetPrefix = (offset: DayOffsetValue, translate: TranslateMessage): string =>
  isNextDay(offset) ? `${translate('shifts-main.day-offset.next')} ` : ''

/**
 * 時刻 + 日偏移 → 一段看得懂的文字。
 *
 * ```ts
 * timeWithOffsetDisplay('06:00', 1, $t)   // '隔日 06:00'
 * timeWithOffsetDisplay('22:00', 0, $t)   // '22:00'
 * ```
 */
export const timeWithOffsetDisplay = (time: string, offset: DayOffsetValue, translate: TranslateMessage): string =>
  `${dayOffsetPrefix(offset, translate)}${time}`
