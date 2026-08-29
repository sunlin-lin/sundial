/**
 * 查詢條件 → 送給後端 `list-by-date` 的參數（前端規範 §1.3 第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * UI 定案（`docs/ui/23-ui-daily-attendance-records.md`）「查詢條件」列了「日期／部門／人員／
 * 狀態」四項，`POST /attendance/records/list-by-date` 的 request schema 現在四項都收得下：
 * `status` 是選填的 `'all' | 'active' | 'revoked'`，未帶等同 `'all'`。**這裡刻意一律送出**，
 * 不利用「未帶等同 all」這件事省略欄位——`isListEcho`（§7.3）比對的是回應 `search` 的每一把鍵，
 * 而回應的 `search.status` 是必填欄位，永遠會回聲一個值（未篩選時回 `'all'`）；查詢那一側若省略
 * `status`，`query['status']` 會是 `undefined`，跟回聲的 `'all'` 對不上，回聲比對永遠失敗。
 *
 * **排序**：UI 定案要求「先依員工（工號）排序，同一員工當天的多筆打卡再依打卡時間由早到晚」，
 * 後端排序白名單（`ATTENDANCE_RECORD_LIST_SORT_FIELDS`）現在含 `employeeCode`，預設也已經是
 * `{ field: 'employeeCode', order: 'asc' }`（`employeeCode` → `clockedAt` → `id`）。這裡明確送出
 * 這個排序，理由與 `status` 相同：`sort` 也是回聲比對的對象，明確送出比依賴「後端預設」更不容易
 * 因為日後預設值變動而讓回聲對不上。
 */
import type { AttendanceRecordsListByDateInput } from '../../../api/generated/api-client.ts'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'

/** UI 23「狀態」查詢條件的三個值：全部（預設）／只看有效／只看已撤銷。與 API 的
 * `status` 欄位同一組字面量，直接由產生型別推導，不另外手刻一份會漂移的清單。 */
export type AttendanceDailyRecordStatusFilter = NonNullable<AttendanceRecordsListByDateInput['status']>

export type AttendanceDailyRecordFilters = {
  date: string
  /** `null` 表示不篩選部門。**不是 `''` 哨兵值**——`ElTreeSelect` 的 `clearable` 清空時給的是
   * `null`（`employees-onboarding` 的 `jobTitleId` 是同一個既有先例：可清空的 `ElTreeSelect`
   * 用 `string | null`，前端規範 §1.7 的哨兵值手法是給 `ElRadioGroup` 這種結構上不接受
   * `null`／`undefined` 的元件用的，`ElTreeSelect` 沒有這個限制，不需要另外發明一個哨兵值）。 */
  departmentId: string | null
  /** `null` 表示不篩選特定員工。 */
  employeeId: string | null
  /** UI 23：「全部」是預設值、是一個真正的業務值，不是「還沒選」的哨兵——`ElRadioGroup` 一律
   * 有預設選取，不會出現 `undefined`／`null`，不需要 §1.7 的哨兵值手法。 */
  status: AttendanceDailyRecordStatusFilter
}

export const defaultAttendanceDailyRecordFilters = (): AttendanceDailyRecordFilters => ({
  date: todayInTaipei(),
  departmentId: null,
  employeeId: null,
  status: 'all',
})

export type AttendanceDailyRecordListQuery = AttendanceRecordsListByDateInput & {
  readonly status: AttendanceDailyRecordStatusFilter
  readonly sort: NonNullable<AttendanceRecordsListByDateInput['sort']>
}

export const ATTENDANCE_DAILY_RECORD_PER_PAGE = 20

/** UI 23 定案的排序語意；後端預設同值（見檔頭）。 */
export const ATTENDANCE_DAILY_RECORD_SORT = { field: 'employeeCode', order: 'asc' } as const

/** 部門／人員用展開式**省略**沒帶的條件，不是設成 `undefined`——`exactOptionalPropertyTypes`
 * 底下兩者是不同形狀（`employees-main.payload.ts` 的 `toEmployeeListQuery` 同構寫法）。
 * `status`／`sort` 則一律送出（見檔頭：兩者都是回聲比對的對象，不能靠「未帶等同預設」省略）。 */
export const toAttendanceDailyRecordListQuery = (
  filters: AttendanceDailyRecordFilters,
  currentPage: number,
): AttendanceDailyRecordListQuery => ({
  date: filters.date,
  ...(filters.departmentId === null ? {} : { departmentId: filters.departmentId }),
  ...(filters.employeeId === null ? {} : { employeeId: filters.employeeId }),
  status: filters.status,
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
