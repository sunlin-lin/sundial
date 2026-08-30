/**
 * 查詢條件 → 送給後端 `attendance/results/list-own` 的參數（前端規範 §1.3 第 (4) 類、§0.5 的
 * `.payload.ts`）。
 *
 * UI 定案（`docs/ui/12-ui-my-attendance.md`）「年月查詢」：只有年月，**不提供部門或人員選擇，
 * 因本頁固定只查本人**——`POST /attendance/results/list-own` 的 request schema 也確實沒有
 * `departmentId`／`employeeId` 這兩個欄位（計畫「body 不得接受 employeeId」）。
 *
 * **一次拿完整月，不分頁**：UI 12「一個月最多約 31 列，預設不分頁」。`perPage` 的上限是 100
 * （`shared/field-schemas.ts` 的 `PageRequest`），31 天遠在上限之內，因此這裡固定
 * `perPage: ATTENDANCE_MINE_PER_PAGE`、`currentPage: 1`，頁面不提供換頁 UI。
 *
 * **排序**：後端 `list-own` 未帶 `sort` 時的預設是 `{ field: 'workDate', order: 'desc' }`
 * （`attendance-results.handler.ts` 的 `DEFAULT_LIST_OWN_SORT`），逐字對應 UI 12「日期預設由新到舊
 * 排列」。這裡明確送出這個值而不是省略，理由同 `attendance-all.payload.ts`：`sort` 是 §7.3
 * 回聲比對的對象。
 */
import type { AttendanceResultsListOwnInput } from '../../../api/generated/api-client.ts'
import { formatYearMonth } from '../../../shared/format/business-date.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'

export type AttendanceMineFilters = {
  /** `YYYY-MM`，進入頁面時預設系統當月（UI 12「年月查詢」）。 */
  yearMonth: string
}

export const defaultAttendanceMineFilters = (): AttendanceMineFilters => ({
  yearMonth: formatYearMonth(todayInTaipei()),
})

export type AttendanceMineListQuery = AttendanceResultsListOwnInput & {
  readonly sort: NonNullable<AttendanceResultsListOwnInput['sort']>
}

/** 一個月最多 31 天，遠在 `perPage` 上限（100）之內，一次拿完不分頁（見檔頭）。 */
export const ATTENDANCE_MINE_PER_PAGE = 100

export const ATTENDANCE_MINE_SORT = { field: 'workDate', order: 'desc' } as const

export const toAttendanceMineListQuery = (filters: AttendanceMineFilters): AttendanceMineListQuery => ({
  yearMonth: filters.yearMonth,
  currentPage: 1,
  perPage: ATTENDANCE_MINE_PER_PAGE,
  sort: ATTENDANCE_MINE_SORT,
})
