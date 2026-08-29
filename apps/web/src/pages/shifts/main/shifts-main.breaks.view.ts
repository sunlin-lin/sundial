/**
 * 休息時段：清單欄怎麼組，以及表單編輯用的本地列形狀（依 §0.7 從 `.view.ts` 拆出來的兄弟檔）。
 *
 * 休息的起訖**各自**有日偏移（`startDayOffset`／`endDayOffset`）——這是計畫 04 §4.2 對資料字典的
 * 唯一增補：22:00–06:00 的夜班休息 02:00–03:00，沒有日偏移分不出這個 02:00 是班次開始前二十小時
 * 還是開始後四小時。因此本地編輯列比工作時段多一個日偏移欄位，不能共用同一個型別。
 */
import type { ShiftsMainListData } from '../../../api/generated/api-client.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { timeWithOffsetDisplay } from './shifts-main.day-offset.view.ts'

/** 清單／明細回應裡的一段休息（API 形狀，含後端算好的 `breakMinutes`，由產生型別推導）。 */
export type ApiBreak = ShiftsMainListData['data'][number]['breaks'][number]

/**
 * 表單編輯中的一段休息。**沒有 `sequenceNo`、也沒有 `breakMinutes`**——理由同工作時段
 * （`shifts-main.periods.view.ts` 檔頭），差別只在多了 `startDayOffset`。
 */
export type LocalBreak = {
  startTime: string
  endTime: string
  startDayOffset: 0 | 1
  endDayOffset: 0 | 1
  isPaid: boolean
}

/** 新增一段休息的預設值：空白時間、當日、無薪。 */
export const newBreak = (): LocalBreak => ({
  startTime: '',
  endTime: '',
  startDayOffset: 0,
  endDayOffset: 0,
  isPaid: false,
})

/** 有薪／無薪的文字。§9.1 要求狀態不能只靠顏色，因此清單與表單都用文字而不是單純一個顏色點。 */
export const paidLabel = (isPaid: boolean, translate: TranslateMessage): string =>
  translate(isPaid ? 'shifts-main.break.paid' : 'shifts-main.break.unpaid')

/**
 * 一段休息 → 一行看得懂的文字，例如 `'隔日 02:00–隔日 03:00（無薪）'`。
 *
 * 同時吃得下 API 列與本地編輯列，理由同 `periodRangeDisplay`（`shifts-main.periods.view.ts`）。
 */
export const breakRangeDisplay = (
  entry: Pick<ApiBreak, 'startTime' | 'endTime' | 'startDayOffset' | 'endDayOffset' | 'isPaid'>,
  translate: TranslateMessage,
): string =>
  `${timeWithOffsetDisplay(entry.startTime, entry.startDayOffset, translate)}` +
  `–${timeWithOffsetDisplay(entry.endTime, entry.endDayOffset, translate)}` +
  `（${paidLabel(entry.isPaid, translate)}）`

/**
 * 清單那一格：多段休息各自一行；**沒有休息時顯示「沒有值」，不是錯誤**——中空班、一般班本來就
 * 可能沒有任何休息（計畫沒有規定每個班別都要有休息）。
 */
export const breaksSummaryDisplay = (
  breaks: readonly Pick<ApiBreak, 'startTime' | 'endTime' | 'startDayOffset' | 'endDayOffset' | 'isPaid'>[],
  translate: TranslateMessage,
): string =>
  breaks.length === 0 ? EMPTY_DISPLAY : breaks.map((entry) => breakRangeDisplay(entry, translate)).join('\n')
