/**
 * 補打卡申請的端點目錄（§0.4「routes 不拆」、§1.9）。對應 UI 13，員工端三個動作：`submit`
 * （提交）、`withdraw`（撤回）、`list-own`（查詢自己的申請）。核准／退回／撤銷核准／撤銷退回
 * 排在 Stage 9（`attendance_correction_reviews`），本檔不含。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換，由身分驗證 middleware 自己推導。
 * 三支端點對應三個權限碼：`attendance.correction-requests.submit`／`.withdraw`／`.list-own`。
 *
 * **沒有座標可見範圍那種分支**：這三支端點的回應恆是呼叫者自己的申請，不需要像 `attendance/
 * records` 的 `get` 那樣依身分決定回不回欄位（見 `attendance-correction-requests.handler.ts`
 * 檔頭）。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  IsoDate,
  PageRequest,
  paginationResponse,
  Reason,
  sortRequest,
  TaipeiDateTime,
  Uuid,
  YearMonth,
} from '../../../shared/field-schemas.ts'
import {
  handleAttendanceCorrectionRequestListOwn,
  handleAttendanceCorrectionRequestSubmit,
  handleAttendanceCorrectionRequestWithdraw,
  type AttendanceCorrectionRequestsDependencies,
} from './attendance-correction-requests.handler.ts'
import {
  ATTENDANCE_CORRECTION_REQUESTS_ENDPOINT_ERRORS,
  describeAttendanceCorrectionRequestErrors,
} from './attendance-correction-requests.errors.ts'

/** 打卡事件類型。值必須與 `db/schema/attendance-records.ts` 的 `AttendanceTypeCode` 相同——
 * 補打卡申請與正式打卡共用同一套代碼（`db/schema/attendance-correction-requests.ts` 檔頭）。 */
const AttendanceTypeCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/** 申請狀態代碼。值必須與 `db/schema/attendance-correction-requests.ts` 的
 * `AttendanceCorrectionRequestStatusCode` 相同：待審核、已核准、未核准、已撤回（UI 13）。 */
const AttendanceCorrectionRequestStatusCodeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)])

/** `submit`／`withdraw` 共用的明細形狀：兩者回應恆是呼叫者自己的申請完整內容。 */
const AttendanceCorrectionRequestDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  employmentId: Uuid,
  workDate: IsoDate,
  attendanceTypeCode: AttendanceTypeCodeSchema,
  requestedClockedAt: TaipeiDateTime,
  reason: t.String({ minLength: 1, maxLength: 500 }),
  statusCode: AttendanceCorrectionRequestStatusCodeSchema,
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** `list-own` 單筆：UI 13 列表欄位（申請日期、補卡日期、類型、申請補登時間、原因、狀態）。
 * **不含 `employeeId`／`employmentId`**——查的必然是自己，見 `domain/
 * attendance-correction-request-model.ts` 的 `OwnAttendanceCorrectionRequestListItem` 檔頭。 */
const OwnAttendanceCorrectionRequestListItemSchema = t.Object({
  id: Uuid,
  workDate: IsoDate,
  attendanceTypeCode: AttendanceTypeCodeSchema,
  requestedClockedAt: TaipeiDateTime,
  reason: t.String({ minLength: 1, maxLength: 500 }),
  statusCode: AttendanceCorrectionRequestStatusCodeSchema,
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** `list-own` 的狀態篩選（UI 13「查詢與列表」）：全部（預設）、待審核、已核准、未核准、已撤回。 */
const AttendanceCorrectionRequestListStatusSchema = t.Union([
  t.Literal('all'),
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('rejected'),
  t.Literal('withdrawn'),
])

const OwnAttendanceCorrectionRequestListSearchSchema = t.Object({
  yearMonth: YearMonth,
  // 一律回聲解析後的值（沒送等同 'all'），比照 `attendance/records` 的 `list-by-date` 對
  // `status` 的處理——這一欄永遠有一個生效值，沒有「沒篩選」與「篩了但送 undefined」的分別。
  status: AttendanceCorrectionRequestListStatusSchema,
})

/** `list-own` 只支援依補卡日期排序——範圍固定是本人，沒有「依員工分組」的需求。 */
const ATTENDANCE_CORRECTION_REQUEST_LIST_OWN_SORT_FIELDS = ['workDate'] as const

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。這三種與業務邏輯無關，由 middleware 與
 * 統一 error handler 產生（`900` 未登入／`901` 無權限／`400` 系統錯誤），`data` 恆為 `null`、
 * `errors` 恆為空陣列（§1.3）。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/** 業務錯誤的回應形狀。409／422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 補打卡申請的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）。
 */
export const attendanceCorrectionRequestsRoutes = (dependencies: AttendanceCorrectionRequestsDependencies) =>
  new Elysia({ name: 'attendance-correction-requests-routes' })
    .use(requestContext)
    .post(
      '/attendance/correction-requests/submit',
      (context) => handleAttendanceCorrectionRequestSubmit(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('attendance.correction-requests.submit'),
          attendanceTypeCode: AttendanceTypeCodeSchema,
          workDate: IsoDate,
          requestedClockedAt: TaipeiDateTime,
          reason: Reason,
        }),
        response: {
          200: envelope(AttendanceCorrectionRequestDetailSchema),
          ...BusinessFailureResponses,
          ...CommonFailureResponses,
        },
        detail: {
          summary: '提交補打卡申請（上班或下班分開申請）',
          description: `${describeAttendanceCorrectionRequestErrors(ATTENDANCE_CORRECTION_REQUESTS_ENDPOINT_ERRORS.submit)} employeeId／employmentId 不是輸入，由 token 推出的操作者身分決定；申請本身不寫入 attendance_records，核准後才會建立正式打卡（Stage 9）。`,
        },
      },
    )
    .post(
      '/attendance/correction-requests/withdraw',
      (context) => handleAttendanceCorrectionRequestWithdraw(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('attendance.correction-requests.withdraw'),
          requestId: Uuid,
        }),
        response: {
          200: envelope(AttendanceCorrectionRequestDetailSchema),
          ...BusinessFailureResponses,
          ...CommonFailureResponses,
        },
        detail: {
          summary: '撤回自己的補打卡申請（只有待審核申請可以撤回）',
          description: `${describeAttendanceCorrectionRequestErrors(ATTENDANCE_CORRECTION_REQUESTS_ENDPOINT_ERRORS.withdraw)} 不接受 employeeId：只能撤回 token 推出的本人申請，指向別人的申請視同找不到。`,
        },
      },
    )
    .post(
      '/attendance/correction-requests/list-own',
      (context) => handleAttendanceCorrectionRequestListOwn(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('attendance.correction-requests.list-own'),
          yearMonth: YearMonth,
          status: t.Optional(AttendanceCorrectionRequestListStatusSchema),
          ...PageRequest,
          sort: t.Optional(sortRequest(ATTENDANCE_CORRECTION_REQUEST_LIST_OWN_SORT_FIELDS)),
        }),
        response: {
          200: envelope(
            paginationResponse(
              OwnAttendanceCorrectionRequestListSearchSchema,
              OwnAttendanceCorrectionRequestListItemSchema,
            ),
          ),
          ...CommonFailureResponses,
        },
        detail: {
          summary: '查詢本人的補打卡申請（依年月＋狀態篩選，UI 13）',
          description: `${describeAttendanceCorrectionRequestErrors(ATTENDANCE_CORRECTION_REQUESTS_ENDPOINT_ERRORS.listOwn)} 範圍固定為 token 推出的本人，不接受 employeeId；status 未帶時等同 all。預設依補卡日期由新到舊排序（UI 13）。`,
        },
      },
    )
