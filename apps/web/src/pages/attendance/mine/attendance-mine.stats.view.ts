/**
 * 我的出勤：當月出勤統計的彙總（前端規範 §1.3 第 (1) 類、§0.7 主題拆分檔）。UI 定案
 * `docs/ui/12-ui-my-attendance.md` §「當月出勤統計」，已由使用者確認。
 *
 * **後端刻意不做聚合端點**：一頁最多 31 列、`perPage` 上限 100 足夠一次拿完整月，因此統計由前端
 * 對 `attendance-mine.view.ts` 用的同一批列表資料逐列彙總，不是另外呼叫一支統計端點（也沒有
 * 這樣的端點可呼叫）。
 *
 * **拆成兩層，分別測試**：{@link summarizeAttendanceMineMonth} 只做純數字彙總（不吃 `translate`），
 * {@link toAttendanceMineStatsDisplay} 只做數字 → 顯示字串（吃 `translate`，因為要接單位）。
 * 分開的理由是讓「彙總邏輯對不對」與「文案怎麼組」各自能被逐格測試覆蓋，且彙總邏輯不會因為
 * 語系檔的 key 改名而牽動測試。
 */
import { formatHoursFromMinutes, toSafeMinutes } from '../../../shared/format/duration.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { AttendanceMineListItem } from './attendance-mine.view.ts'

/** 純數字彙總結果。 */
export type AttendanceMineMonthSummary = {
  /** 當月有有效出勤紀錄的工作日數；同一天只計一次——一列即一個 `work_date`，`attendance_results`
   * 對 `(company_id, employee_id, work_date)` 有唯一鍵（`0040_create_attendance_results.sql`），
   * 因此 `items.length` 就是不重複的工作日數，不需要另外去重。 */
  readonly attendanceDays: number
  /** 加總 `workedMinutes`，尚未換算成小時（換算在 {@link toAttendanceMineStatsDisplay}）。 */
  readonly totalWorkedMinutes: number
  /** `lateMinutes > 0` 的工作日數（UI 12：同一天同時遲到及早退時，兩項各計一天——用兩個獨立的
   * `filter` 而不是共用一次迴圈判斷，就是要讓兩者天然互不影響）。 */
  readonly lateDays: number
  readonly earlyLeaveDays: number
  readonly absentDays: number
}

export const summarizeAttendanceMineMonth = (items: readonly AttendanceMineListItem[]): AttendanceMineMonthSummary => ({
  attendanceDays: items.length,
  totalWorkedMinutes: items.reduce((sum, item) => sum + toSafeMinutes(item.workedMinutes), 0),
  lateDays: items.filter((item) => toSafeMinutes(item.lateMinutes) > 0).length,
  earlyLeaveDays: items.filter((item) => toSafeMinutes(item.earlyLeaveMinutes) > 0).length,
  absentDays: items.filter((item) => toSafeMinutes(item.absenceMinutes) > 0).length,
})

/** 一格統計卡片：標題＋算好的顯示字串（模板只讀這裡，§1.4）。 */
export type AttendanceMineStatCard = { readonly labelKey: MessageKey; readonly valueDisplay: string }

/** UI 12 範例：「出勤 22 天／總工時 170.1 小時／遲到 1 天／早退 1 天／缺勤 0 天」，
 * 五張卡片依此固定順序輸出。 */
export const toAttendanceMineStatsDisplay = (
  summary: AttendanceMineMonthSummary,
  translate: TranslateMessage,
): readonly AttendanceMineStatCard[] => {
  const daysUnit = translate('attendance.unit.days')
  const hoursUnit = translate('attendance.unit.hours')
  return [
    {
      labelKey: 'attendance-mine.stats.attendance-days',
      valueDisplay: `${String(summary.attendanceDays)} ${daysUnit}`,
    },
    {
      labelKey: 'attendance-mine.stats.total-worked-hours',
      valueDisplay: `${formatHoursFromMinutes(summary.totalWorkedMinutes)} ${hoursUnit}`,
    },
    { labelKey: 'attendance-mine.stats.late-days', valueDisplay: `${String(summary.lateDays)} ${daysUnit}` },
    {
      labelKey: 'attendance-mine.stats.early-leave-days',
      valueDisplay: `${String(summary.earlyLeaveDays)} ${daysUnit}`,
    },
    { labelKey: 'attendance-mine.stats.absent-days', valueDisplay: `${String(summary.absentDays)} ${daysUnit}` },
  ]
}
