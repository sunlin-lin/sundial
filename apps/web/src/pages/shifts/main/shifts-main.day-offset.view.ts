/**
 * 日偏移的文字化（前端規範必做事項 2；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * 跨日班的 `endDayOffset=1` 直接顯示數字沒有人看得懂，畫面上要呈現成「隔日 06:00」這種形式。
 * 休息的起訖各有日偏移（計畫 §4.2 的唯一增補），因此本檔的函式同時服務工作時段與休息時段——
 * 兩者都是「一個時刻 + 一個日偏移」，呈現規則完全相同，不必各寫一份。
 *
 * `offset` 過去曾經需要防禦字串輸入：後端回應方向誤用了可強制轉型的 `t.Integer`，OpenAPI 上
 * 留了 `string | number` 的影子。`check:response-coercion` 掃出並修正這一批誤用後，
 * `endDayOffset`／`startDayOffset` 在回應方向都已經是乾淨的 `number`（值只會是 `0` 或 `1`，
 * 見 `ShiftDayOffset` 的 `minimum`／`maximum`），字串分支因此拿掉——不要因為
 * 「看起來像防禦性寫法」就加回來。
 */
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 後端 `ShiftDayOffset` 的合法值只有 `0`／`1`。 */
export type DayOffsetValue = number

/** 是否為隔日。 */
export const isNextDay = (offset: DayOffsetValue): boolean => offset === 1

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
