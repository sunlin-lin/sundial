/**
 * 查詢條件 → 送給後端 `attendance/results/list` 的參數（前端規範 §1.3 第 (4) 類、§0.5 的
 * `.payload.ts`）。
 *
 * UI 定案（`docs/ui/09-ui-all-attendance.md`）「查詢條件」列了「年月（必選）／部門（可選）／
 * 人員（可選）」三項，`POST /attendance/results/list` 的 request schema 對應得上：`yearMonth`
 * 必填，`departmentId`／`employeeId` 選填。
 *
 * **排序**：UI 09 沒有像 UI 23（daily-records）那樣明文一個排序規則，後端 `list` 未帶 `sort` 時的
 * 預設是 `{ field: 'workDate', order: 'desc' }`（`attendance-results.handler.ts` 的
 * `DEFAULT_LIST_SORT`）。這裡選擇**明確送出**這個排序而不是省略——理由與 `attendance-daily-
 * records.payload.ts` 相同：`sort` 是 §7.3 回聲比對的對象，明確送出比依賴「後端預設」更不容易
 * 因為日後預設值變動而讓回聲對不上。（這是本頁的判斷，非 UI 09 明文要求，已在任務回報中說明。）
 */
import type { AttendanceResultsListInput } from '../../../api/generated/api-client.ts'
import { formatYearMonth } from '../../../shared/format/business-date.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'

export type AttendanceAllFilters = {
  /** `YYYY-MM`，必選，預設系統當月。 */
  yearMonth: string
  /** `null` 表示不篩選部門。不是 `''` 哨兵值——`ElTreeSelect` 的 `clearable` 清空時給的是
   * `null`（`attendance-daily-records.payload.ts` 的 `departmentId` 是同一個既有先例）。 */
  departmentId: string | null
  /** `null` 表示不篩選特定員工。 */
  employeeId: string | null
}

export const defaultAttendanceAllFilters = (): AttendanceAllFilters => ({
  yearMonth: formatYearMonth(todayInTaipei()),
  departmentId: null,
  employeeId: null,
})

export type AttendanceAllListQuery = AttendanceResultsListInput & {
  readonly sort: NonNullable<AttendanceResultsListInput['sort']>
}

export const ATTENDANCE_ALL_PER_PAGE = 20

/** `list` 未帶 `sort` 時的後端預設值（見檔頭），這裡明確送出同一個值。 */
export const ATTENDANCE_ALL_SORT = { field: 'workDate', order: 'desc' } as const

/** 部門／人員用展開式**省略**沒帶的條件，不是設成 `undefined`——`exactOptionalPropertyTypes`
 * 底下兩者是不同形狀（`attendance-daily-records.payload.ts` 的 `toAttendanceDailyRecordListQuery`
 * 同構寫法）。`yearMonth`／`sort` 則一律送出（見檔頭：兩者都是回聲比對的對象）。 */
export const toAttendanceAllListQuery = (
  filters: AttendanceAllFilters,
  currentPage: number,
): AttendanceAllListQuery => ({
  yearMonth: filters.yearMonth,
  ...(filters.departmentId === null ? {} : { departmentId: filters.departmentId }),
  ...(filters.employeeId === null ? {} : { employeeId: filters.employeeId }),
  currentPage,
  perPage: ATTENDANCE_ALL_PER_PAGE,
  sort: ATTENDANCE_ALL_SORT,
})

/** 是否有套用部門或人員篩選——空結果時用來分辨「本來就沒資料」與「篩選後無結果」
 * （前端規範 §7.2：兩種空狀態要分開，後者要提示可清除篩選）。 */
export const hasActiveAttendanceAllFilters = (filters: AttendanceAllFilters): boolean =>
  filters.departmentId !== null || filters.employeeId !== null
