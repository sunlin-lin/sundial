/**
 * 查詢條件 → 送給後端 `list-by-date` 的參數（前端規範 §1.3 第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * **UI 定案（`docs/ui/23-ui-daily-attendance-records.md`）列了「日期／部門／人員／狀態」四項查詢
 * 條件，這裡只做得出前三項。** `POST /attendance/records/list-by-date` 的 request schema
 * （`attendance-records.routes.ts`）只收 `date`／`departmentId`／`employeeId`——沒有「只看有效／
 * 只看已撤銷」這個狀態篩選欄位。這不是可以在前端補上的缺口：後端一次只回一頁（`perPage`／
 * `currentPage`），若要在前端把已撤銷紀錄濾掉再顯示，這一頁的筆數與 `totalCount` 就會對不上
 * （某一頁全部被濾掉時會顯示成一頁空白，而後端回報的還有下一頁）。本檔不虛構這個條件，
 * 只組裝後端真的認得的三項＋分頁＋固定排序，已在交付報告裡回報這個後端缺口。
 *
 * **排序同樣受限於後端**：UI 定案要求「先依員工（工號）排序，同一員工當天的多筆打卡再依打卡
 * 時間排列」，但 `attendance-records.routes.ts` 的 `ATTENDANCE_RECORD_LIST_SORT_FIELDS` 只有
 * `clockedAt` 一種可排序欄位，沒有「依員工分組」這個排序方式。這裡只送得出 `clockedAt` 升冪，
 * 同樣已在交付報告回報。
 */
import type { AttendanceRecordsListByDateInput } from '../../../api/generated/api-client.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'

export type AttendanceDailyRecordFilters = {
  date: string
  /** `null` 表示不篩選部門。**不是 `''` 哨兵值**——`ElTreeSelect` 的 `clearable` 清空時給的是
   * `null`（`employees-onboarding` 的 `jobTitleId` 是同一個既有先例：可清空的 `ElTreeSelect`
   * 用 `string | null`，前端規範 §1.7 的哨兵值手法是給 `ElRadioGroup` 這種結構上不接受
   * `null`／`undefined` 的元件用的，`ElTreeSelect` 沒有這個限制，不需要另外發明一個哨兵值）。 */
  departmentId: string | null
  /** `null` 表示不篩選特定員工。 */
  employeeId: string | null
}

export const defaultAttendanceDailyRecordFilters = (): AttendanceDailyRecordFilters => ({
  date: todayInTaipei(),
  departmentId: null,
  employeeId: null,
})

export type AttendanceDailyRecordListQuery = AttendanceRecordsListByDateInput & {
  readonly sort: NonNullable<AttendanceRecordsListByDateInput['sort']>
}

export const ATTENDANCE_DAILY_RECORD_PER_PAGE = 20

/** 見檔頭：後端只支援依 `clockedAt` 排序，這是唯一送得出的排序條件。 */
export const ATTENDANCE_DAILY_RECORD_SORT = { field: 'clockedAt', order: 'asc' } as const

/** 用展開式**省略**沒帶的條件，不是設成 `undefined`——`exactOptionalPropertyTypes` 底下兩者是
 * 不同形狀（`employees-main.payload.ts` 的 `toEmployeeListQuery` 同構寫法）。 */
export const toAttendanceDailyRecordListQuery = (
  filters: AttendanceDailyRecordFilters,
  currentPage: number,
): AttendanceDailyRecordListQuery => ({
  date: filters.date,
  ...(filters.departmentId === null ? {} : { departmentId: filters.departmentId }),
  ...(filters.employeeId === null ? {} : { employeeId: filters.employeeId }),
  currentPage,
  perPage: ATTENDANCE_DAILY_RECORD_PER_PAGE,
  sort: ATTENDANCE_DAILY_RECORD_SORT,
})

/** 撤銷原因表單值 → 送出 payload。與 `dashboard-main.payload.ts` 的 `RevokeFormState`／
 * `toRevokePayload` 同構——差別只在這裡呼叫的是 `revoke-other`（他人撤銷），欄位形狀相同
 * （計畫 §4.3：兩支端點 body 欄位相同，差別在授權與稽核，不在 body）。 */
export type RevokeOtherFormState = { reason: string }

export const emptyRevokeOtherFormState = (): RevokeOtherFormState => ({ reason: '' })

export const toRevokeOtherPayload = (
  recordId: string,
  form: RevokeOtherFormState,
): { recordId: string; reason: string } => ({
  recordId,
  reason: form.reason.trim(),
})
