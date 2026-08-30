/**
 * 補打卡申請的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 *
 * **三個動作，只有員工端**（計畫 §5 Stage 8）：`submit`（提交）、`withdraw`（撤回）、`listOwn`
 * （查詢自己的申請）。核准／退回／撤銷核准／撤銷退回排在 Stage 9（`attendance_correction_reviews`）。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { AttendanceCorrectionRequestsContext } from './domain/attendance-correction-request-context.ts'
import type {
  AttendanceCorrectionRequestDetail,
  ListOwnAttendanceCorrectionRequestsPage,
  ListOwnAttendanceCorrectionRequestsQuery,
  SubmitAttendanceCorrectionRequestInput,
  WithdrawAttendanceCorrectionRequestInput,
} from './domain/attendance-correction-request-model.ts'
import { submitAttendanceCorrectionRequest as submitAttendanceCorrectionRequestImpl } from './impl/attendance-correction-requests.submit.service.ts'
import { withdrawAttendanceCorrectionRequest as withdrawAttendanceCorrectionRequestImpl } from './impl/attendance-correction-requests.withdraw.service.ts'
import { listOwnAttendanceCorrectionRequests as listOwnAttendanceCorrectionRequestsImpl } from './impl/attendance-correction-requests.list-own.service.ts'

export type { AttendanceCorrectionRequestsContext }
export type {
  AttendanceCorrectionRequestDetail,
  ListOwnAttendanceCorrectionRequestsPage,
  ListOwnAttendanceCorrectionRequestsQuery,
  OwnAttendanceCorrectionRequestListItem,
  SubmitAttendanceCorrectionRequestInput,
  WithdrawAttendanceCorrectionRequestInput,
} from './domain/attendance-correction-request-model.ts'

export const submitAttendanceCorrectionRequest = (
  context: AttendanceCorrectionRequestsContext,
  input: SubmitAttendanceCorrectionRequestInput,
): Promise<ServiceResult<AttendanceCorrectionRequestDetail>> => submitAttendanceCorrectionRequestImpl(context, input)

export const withdrawAttendanceCorrectionRequest = (
  context: AttendanceCorrectionRequestsContext,
  input: WithdrawAttendanceCorrectionRequestInput,
): Promise<ServiceResult<AttendanceCorrectionRequestDetail>> => withdrawAttendanceCorrectionRequestImpl(context, input)

export const listOwnAttendanceCorrectionRequests = (
  context: AttendanceCorrectionRequestsContext,
  query: ListOwnAttendanceCorrectionRequestsQuery,
): Promise<ServiceResult<ListOwnAttendanceCorrectionRequestsPage>> =>
  listOwnAttendanceCorrectionRequestsImpl(context, query)
