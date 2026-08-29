/**
 * 工作時段：清單欄怎麼組，以及表單編輯用的本地列形狀（依 §0.7 從 `.view.ts` 拆出來的兄弟檔）。
 *
 * 一段工作時段只有一個日偏移（`endDayOffset`）——時段一律從當日某個時刻開始，最長跨到隔天
 * （後端 `ShiftDayOffset` 的 `minimum: 0, maximum: 1`），因此本地編輯列的形狀直接對映後端的
 * `ShiftWorkPeriodInputSchema`，不需要再多一個 `startDayOffset`。
 */
import type { ShiftsMainListData } from '../../../api/generated/api-client.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { timeWithOffsetDisplay } from './shifts-main.day-offset.view.ts'

/** 清單／明細回應裡的一段工作時段（API 形狀，含後端算好的 `workMinutes`，由產生型別推導）。 */
export type ApiWorkPeriod = ShiftsMainListData['data'][number]['workPeriods'][number]

/**
 * 表單編輯中的一段工作時段。**沒有 `sequenceNo`、也沒有 `workMinutes`**：
 * 前者由 `.payload.ts` 依陣列順序自動編（使用者不必理解「順序編號」這個概念）；
 * 後者是推導值，前端不送、也不在編輯列裡假裝有這個欄位（必做事項 1）。
 */
export type LocalWorkPeriod = {
  startTime: string
  endTime: string
  endDayOffset: 0 | 1
}

/** 新增一段時段的預設值：空白時間、當日結束。 */
export const newWorkPeriod = (): LocalWorkPeriod => ({ startTime: '', endTime: '', endDayOffset: 0 })

/**
 * 一段時段 → 一行看得懂的文字，例如 `'22:00–隔日 06:00'`。
 *
 * 同時吃得下 API 列（`endDayOffset: number`）與本地編輯列（`endDayOffset: 0 | 1`）：
 * 兩者在這裡要做的事完全相同，型別上 `0 | 1` 本來就是 `number` 的子集，不需要轉換。
 *
 * `endDayOffset` 過去曾經需要防禦字串輸入：後端回應方向誤用了可強制轉型的 `t.Integer`，
 * OpenAPI 上留了 `string | number` 的影子。`check:response-coercion` 掃出並修正這一批誤用後，
 * 回應方向的 `endDayOffset` 已經是乾淨的 `number`，這裡不再需要接受字串——不要因為
 * 「看起來像防禦性寫法」就加回來。
 */
export const periodRangeDisplay = (
  period: Pick<ApiWorkPeriod, 'startTime' | 'endTime' | 'endDayOffset'>,
  translate: TranslateMessage,
): string =>
  // 開始時刻的日偏移固定是 0（工作時段沒有 `startDayOffset`，理由見檔頭），因此不呼叫
  // `timeWithOffsetDisplay` 而是直接印出來——省一次「這一定是當日」的隱性假設要被讀者發現。
  `${period.startTime}–${timeWithOffsetDisplay(period.endTime, period.endDayOffset, translate)}`

/**
 * 清單那一格：多段時段各自一行（§0.7 檔頭同一個理由：中空班、分段班都可能不只一段）。
 * 呼叫端用 `white-space: pre-line` 呈現換行，理由與 `regulatory-sync` 的失敗原因欄相同——
 * 完整顯示不截斷，滑鼠不用 hover 就看得到。
 */
export const periodsSummaryDisplay = (
  periods: readonly Pick<ApiWorkPeriod, 'startTime' | 'endTime' | 'endDayOffset'>[],
  translate: TranslateMessage,
): string =>
  periods.length === 0 ? EMPTY_DISPLAY : periods.map((period) => periodRangeDisplay(period, translate)).join('\n')
