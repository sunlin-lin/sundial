/**
 * 業務層型別（純型別，零執行期程式碼）。放在 `domain/` 而不是入口檔的理由與 `attendance/records/
 * domain/attendance-record-model.ts` 檔頭相同。
 */
import type {
  AttendanceCorrectionRequestStatusCodeValue,
  AttendanceTypeCodeValue,
} from '../../../../db/schema/index.ts'

export type {
  AttendanceCorrectionRequestStatusCodeValue,
  AttendanceTypeCodeValue,
} from '../../../../db/schema/index.ts'

/** `submit`（提交申請）的輸入。**不接受 `employeeId`／`employmentId`**——範圍由 token 推出的身分
 * 決定（比照 `attendance/records` 的 `create`）。 */
export type SubmitAttendanceCorrectionRequestInput = {
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly workDate: string
  readonly requestedClockedAt: string
  readonly reason: string
}

/** 完整明細（服務內部流通與回應共用的形狀，本次目錄沒有「查別人」的分支，不需要另外拆一份
 * 「回應方向」的型別，見 `attendance-correction-requests.handler.ts` 檔頭）。 */
export type AttendanceCorrectionRequestDetail = {
  readonly id: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly requestedClockedAt: string
  readonly reason: string
  readonly statusCode: AttendanceCorrectionRequestStatusCodeValue
  readonly createdAt: string
  readonly updatedAt: string
}

/** `withdraw`（撤回）的輸入。**不接受 `employeeId`**——只能撤回 token 推出的本人申請（計畫
 * §4.3.1 對 `attendance/records` 的 `revoke` 是同一個判準，這裡援用同一種形狀）。 */
export type WithdrawAttendanceCorrectionRequestInput = {
  readonly requestId: string
}

/** `list-own` 的狀態篩選（UI 13）：全部／待審核／已核准／未核准／已撤回。 */
export type AttendanceCorrectionRequestListStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'withdrawn'

/** `list-own` 的查詢條件。**不含 `employeeId`**——範圍固定為呼叫者本人（比照 `attendance/records`
 * 的 `list-own-by-date`、`attendance/results` 的 `list-own`）。 */
export type ListOwnAttendanceCorrectionRequestsQuery = {
  readonly yearMonth: string
  readonly status: AttendanceCorrectionRequestListStatus
  readonly perPage: number
  readonly currentPage: number
  readonly sort: { readonly field: 'workDate'; readonly order: 'asc' | 'desc' }
}

/** `list-own` 單筆。UI 13 列表欄位：申請日期（`createdAt`）、補卡日期（`workDate`）、類型、申請
 * 補登時間、原因、狀態；操作欄（查看／撤回）由前端依 `id`／`statusCode` 自行決定，不是回應欄位。 */
export type OwnAttendanceCorrectionRequestListItem = {
  readonly id: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly requestedClockedAt: string
  readonly reason: string
  readonly statusCode: AttendanceCorrectionRequestStatusCodeValue
  readonly createdAt: string
  readonly updatedAt: string
}

export type ListOwnAttendanceCorrectionRequestsPage = {
  readonly items: readonly OwnAttendanceCorrectionRequestListItem[]
  readonly totalCount: number
}
