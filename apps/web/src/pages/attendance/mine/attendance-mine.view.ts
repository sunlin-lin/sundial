/**
 * 我的出勤：列表呈現（前端規範 §1.3 第 (1)(2) 類）。UI 定案
 * `docs/ui/12-ui-my-attendance.md`，已由使用者確認，照該文件實作，不重新設計畫面。
 *
 * 月度統計的彙總邏輯在同目錄的 `attendance-mine.stats.view.ts`（§0.7 主題拆分）——
 * 那是另一種呈現決策（把整個月的列表彙總成 5 個數字），與這裡「單筆列表 → 單列顯示」的職責不同，
 * 分成兩個檔案各自測試比較清楚。
 */
import { formatDate, formatTimeOfDay } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { formatHoursFromMinutes } from '../../../shared/format/duration.ts'
import {
  attendanceResultStatusPresentations,
  type AttendanceResultStatusPresentation,
} from '../../../shared/attendance/result-status.ts'
import { sourceTypeLabel, type AttendanceSourceTypeCodeValue } from '../../../shared/attendance/source-type.ts'
import type { AttendanceResultsListOwnData } from '../../../api/generated/api-client.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 列表單筆 API 原始形狀（由產生型別推導，§3.2）。也是 `attendance-mine.stats.view.ts` 彙總
 * 函式的輸入型別——兩個檔案共用同一份「一天的出勤事實」形狀，不重複定義一次。 */
export type AttendanceMineListItem = AttendanceResultsListOwnData['data'][number]

/** 狀態標籤：已把 `labelKey` 轉成實際文字，模板只讀 `text`（§1.4 模板禁止複雜運算式）。 */
export type StatusBadge = { readonly text: string; readonly tone: AttendanceResultStatusPresentation['tone'] }

/** 表格實際渲染的列——模板只讀這裡算好的字串，不在模板內做任何換算（§1.4）。 */
export type AttendanceMineDisplayRow = {
  readonly id: string
  readonly workDateDisplay: string
  readonly clockInDisplay: string
  readonly clockInLocationDisplay: string
  readonly clockOutDisplay: string
  readonly clockOutLocationDisplay: string
  readonly workedHoursDisplay: string
  readonly lateDisplay: string
  readonly earlyLeaveDisplay: string
  readonly sourceLabel: string
  readonly statuses: readonly StatusBadge[]
}

/** 遲到／早退分鐘 → 顯示字串。UI 12：「遲到或早退為零時顯示『—』」。 */
const minutesDisplay = (minutes: number, translate: TranslateMessage): string =>
  minutes === 0 ? EMPTY_DISPLAY : `${String(minutes)} ${translate('attendance.unit.minutes')}`

const toStatusBadges = (statuses: AttendanceMineListItem['statuses'], translate: TranslateMessage): StatusBadge[] =>
  attendanceResultStatusPresentations(statuses).map((presentation) => ({
    text: translate(presentation.labelKey),
    tone: presentation.tone,
  }))

/** `sourceTypeCode` 可能是 `null`（見 `shared/attendance/source-type.ts` 檔頭）。 */
const sourceDisplay = (code: AttendanceSourceTypeCodeValue | null, translate: TranslateMessage): string =>
  code === null ? EMPTY_DISPLAY : sourceTypeLabel(code, translate)

export const toDisplayRows = (
  items: readonly AttendanceMineListItem[],
  translate: TranslateMessage,
): AttendanceMineDisplayRow[] =>
  items.map((item) => ({
    id: item.id,
    workDateDisplay: formatDate(item.workDate),
    clockInDisplay: formatTimeOfDay(item.clockInAt),
    // 地點欄一律顯示「—」：GPS 反查已暫停（計畫 §4.8），UI 12 已定案這個行為，理由同
    // `attendance-all.view.ts`，不重述。
    clockInLocationDisplay: EMPTY_DISPLAY,
    clockOutDisplay: formatTimeOfDay(item.clockOutAt),
    clockOutLocationDisplay: EMPTY_DISPLAY,
    workedHoursDisplay: `${formatHoursFromMinutes(item.workedMinutes)} ${translate('attendance.unit.hours')}`,
    lateDisplay: minutesDisplay(item.lateMinutes, translate),
    earlyLeaveDisplay: minutesDisplay(item.earlyLeaveMinutes, translate),
    sourceLabel: sourceDisplay(item.sourceTypeCode, translate),
    statuses: toStatusBadges(item.statuses, translate),
  }))
