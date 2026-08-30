/**
 * 全體出勤：列表呈現（前端規範 §1.3 第 (1)(2) 類）。UI 定案
 * `docs/ui/09-ui-all-attendance.md`，已由使用者確認，照該文件實作，不重新設計畫面。
 *
 * 看的是**判定結果**：`attendance_results`，一位員工一天一列。與 `attendance/daily-records`
 * （看原始打卡事實，一位員工一天可能多筆）分工不同，見同目錄 `.route.ts` 檔頭。
 */
import { formatDate, formatTimeOfDay } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { formatHoursFromMinutes, toSafeMinutes } from '../../../shared/format/duration.ts'
import {
  attendanceResultStatusPresentations,
  type AttendanceResultStatusPresentation,
} from '../../../shared/attendance/result-status.ts'
import { sourceTypeLabel, type AttendanceSourceTypeCodeValue } from '../../../shared/attendance/source-type.ts'
import type {
  AttendanceResultsListData,
  DepartmentsMainTreeData,
  EmployeesMainListData,
} from '../../../api/generated/api-client.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 列表單筆 API 原始形狀（由產生型別推導，§3.2）。 */
export type AttendanceAllListItem = AttendanceResultsListData['data'][number]

/** 狀態標籤：已把 `labelKey` 轉成實際文字，模板只讀 `text`（§1.4 模板禁止複雜運算式）。 */
export type StatusBadge = { readonly text: string; readonly tone: AttendanceResultStatusPresentation['tone'] }

/** 表格實際渲染的列——模板只讀這裡算好的字串，不在模板內做任何換算（§1.4）。 */
export type AttendanceAllDisplayRow = {
  readonly id: string
  readonly employeeCode: string
  readonly employeeName: string
  readonly departmentName: string
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

/** 遲到／早退分鐘 → 顯示字串。UI 09：「無則顯示『—』」——0 分鐘不是「遲到 0 分鐘」這種寫法，
 * 而是這一天根本沒有遲到／早退這件事。 */
const minutesDisplay = (minutes: number, translate: TranslateMessage): string =>
  minutes === 0 ? EMPTY_DISPLAY : `${String(minutes)} ${translate('attendance.unit.minutes')}`

const toStatusBadges = (statuses: AttendanceAllListItem['statuses'], translate: TranslateMessage): StatusBadge[] =>
  attendanceResultStatusPresentations(statuses).map((presentation) => ({
    text: translate(presentation.labelKey),
    tone: presentation.tone,
  }))

/** `sourceTypeCode` 可能是 `null`（見 `shared/attendance/source-type.ts` 檔頭），這裡補上
 * `null` → `EMPTY_DISPLAY` 的判斷——這是頁面依資料語意做的判斷（§1.3 第 (1) 類），不屬於
 * 共用的 `sourceTypeLabel` 該管的事。 */
const sourceDisplay = (code: AttendanceSourceTypeCodeValue | null, translate: TranslateMessage): string =>
  code === null ? EMPTY_DISPLAY : sourceTypeLabel(code, translate)

export const toDisplayRows = (
  items: readonly AttendanceAllListItem[],
  translate: TranslateMessage,
): AttendanceAllDisplayRow[] =>
  items.map((item) => ({
    id: item.id,
    employeeCode: item.employeeCode,
    employeeName: item.employeeName,
    departmentName: item.departmentName ?? EMPTY_DISPLAY,
    workDateDisplay: formatDate(item.workDate),
    clockInDisplay: formatTimeOfDay(item.clockInAt),
    // 地點欄一律顯示「—」：GPS 反查已暫停（計畫 §4.8），UI 09 已定案這個行為。刻意不讀
    // `item.clockInAddress`／`item.clockOutAddress`——反查暫停後這兩欄理論上恆為 `null`，
    // 但即使後端未來某天寫進了值，這裡也不該因為欄位本身有沒有值而顯示不同的東西
    // （那會讓「暫停」這個決定看起來像 bug，理由同 `attendance-daily-records.view.ts`）。
    clockInLocationDisplay: EMPTY_DISPLAY,
    clockOutDisplay: formatTimeOfDay(item.clockOutAt),
    clockOutLocationDisplay: EMPTY_DISPLAY,
    workedHoursDisplay: `${formatHoursFromMinutes(toSafeMinutes(item.workedMinutes))} ${translate('attendance.unit.hours')}`,
    lateDisplay: minutesDisplay(toSafeMinutes(item.lateMinutes), translate),
    earlyLeaveDisplay: minutesDisplay(toSafeMinutes(item.earlyLeaveMinutes), translate),
    sourceLabel: sourceDisplay(item.sourceTypeCode, translate),
    statuses: toStatusBadges(item.statuses, translate),
  }))

// --- 篩選用的部門樹／人員選項 ------------------------------------------------------------

/** 部門樹節點（由產生型別推導）。與 `attendance-daily-records.view.ts` 的 `DepartmentTreeNode`
 * 形狀相同，但這裡不從那裡 import——兩個頁面互不 import（前端規範 §1.5、§0.11）。 */
export type DepartmentTreeNode = DepartmentsMainTreeData[number]

/** 員工搜尋結果單筆（由產生型別推導）。 */
export type EmployeeSearchResult = EmployeesMainListData['data'][number]

/** `ElTreeSelect` 用的人員選項：把工號併進顯示文字，理由是 UI 09「可依員工編號或姓名搜尋」
 * ——選單本身也要看得出工號，不能只顯示姓名（同名員工無法分辨）。 */
export type EmployeeOption = { readonly id: string; readonly label: string }

export const toEmployeeOptions = (items: readonly EmployeeSearchResult[]): EmployeeOption[] =>
  items.map((item) => ({ id: item.id, label: `${item.employeeCode} ${item.name}` }))
