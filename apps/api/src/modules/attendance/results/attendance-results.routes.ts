/**
 * 出勤判定結果的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 三支端點：`recalculate-no-schedule`（Stage 4，重算全部 `NO_SCHEDULE` 紀錄）、`list`（Stage 7，
 * 全體出勤，公司範圍，UI 09）、`list-own`（Stage 7，我的出勤，本人範圍，UI 12）。`list`／
 * `list-own` 讀取邏輯高度重疊（都是「查 `attendance_results` 拿判定結果、查 `attendance_records`
 * 拿時間地點來源」的複合查詢），差別只在查詢範圍與權限模型，因此拆成兩支端點但共用同一份 domain
 * 組裝函式（`domain/attendance-result-list-view.ts` 的 `buildAttendanceResultListCore`），
 * 見計畫 `plans/06-attendance.md` §5 Stage 7。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。權限碼也不在這裡宣告（§5.2.2），由路徑機械推導：
 * `attendance.results.recalculate-no-schedule`／`.list`／`.list-own`。
 *
 * ## 座標
 *
 * **兩支列表端點一律不回座標**（計畫 §4.2：列表一律不回座標；§4.8：地址反查目前暫停，`address`
 * 恆為 `NULL`，UI 09／12 都已定案「沒有 GPS 或無法取得反查地址時顯示『—』」，因此這裡的
 * `clockInAddress`／`clockOutAddress` 目前必然是 `null`，這是預期行為，不是這支端點的缺陷）。
 *
 * ## 狀態不是單一互斥值
 *
 * UI 09：「同一天可能同時有遲到與早退，或同時有請假與出勤，因此狀態不得在 UI 假設為單一互斥
 * 值。」`statuses` 是陣列，見 `domain/attendance-result-list-view.ts` 的
 * `deriveAttendanceResultStatuses` 檔頭——現階段（Stage 4 無班表判定）永遠只會是
 * `['NO_SCHEDULE']` 一種組合，但形狀從一開始就支援同時出現多個。
 */
import { Elysia, t } from 'elysia'
import { Type } from '@sinclair/typebox'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  IsoDate,
  Minutes,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
  Uuid,
  YearMonth,
} from '../../../shared/field-schemas.ts'
import {
  handleAttendanceResultsList,
  handleAttendanceResultsListOwn,
  handleRecalculateAllNoScheduleAttendanceResults,
  type AttendanceResultsDependencies,
} from './attendance-results.handler.ts'
import {
  ATTENDANCE_RESULTS_LIST_ERROR_CODES,
  ATTENDANCE_RESULTS_LIST_OWN_ERROR_CODES,
  ATTENDANCE_RESULTS_RECALCULATE_NO_SCHEDULE_ERROR_CODES,
} from './attendance-results.errors.ts'

// `recalculatedCount` 是回應方向的欄位（後端算出來的重算筆數，不是使用者輸入），一律用 TypeBox
// 原生的 `Type.Integer`，不是 Elysia 可強制轉型的 `t.Integer`（理由見 `check-response-coercion.ts`
// 檔頭與 `shared/field-schemas.ts` 的 `Pagination` 檔頭）。
const RecalculateAllNoScheduleData = t.Object({ recalculatedCount: Type.Integer({ minimum: 0 }) })

/** 打卡來源類型。值必須與 `db/schema/attendance-records.ts` 的 `AttendanceSourceTypeCode` 相同。 */
const AttendanceSourceTypeCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/** 狀態旗標，值必須與 `domain/attendance-result-list-view.ts` 的 `AttendanceResultStatusFlag`
 * 相同。同一列可以同時出現多個（見本檔檔頭「狀態不是單一互斥值」），因此是陣列不是單一欄位。 */
const AttendanceResultStatusFlagSchema = t.Union([
  t.Literal('NO_SCHEDULE'),
  t.Literal('LATE'),
  t.Literal('EARLY_LEAVE'),
  t.Literal('ABSENT'),
  t.Literal('ON_LEAVE'),
])

/** 兩支列表端點共用的單筆核心欄位（不含員工／部門），對應 `buildAttendanceResultListCore` 組裝
 * 出來的形狀——回應 schema 的分法跟著 domain 組裝函式的分法走，不是巧合。 */
const AttendanceResultCoreSchema = {
  id: Uuid,
  workDate: IsoDate,
  clockInAt: Nullable(TaipeiDateTime),
  clockInAddress: Nullable(t.String({ maxLength: 255 })),
  clockOutAt: Nullable(TaipeiDateTime),
  clockOutAddress: Nullable(t.String({ maxLength: 255 })),
  workedMinutes: Minutes,
  lateMinutes: Minutes,
  earlyLeaveMinutes: Minutes,
  absenceMinutes: Minutes,
  sourceTypeCode: Nullable(AttendanceSourceTypeCodeSchema),
  statuses: t.Array(AttendanceResultStatusFlagSchema),
} as const

/** `list` 單筆：核心欄位＋員工與「該日有效部門」（UI 09）。 */
const AttendanceResultListItemSchema = t.Object({
  ...AttendanceResultCoreSchema,
  employeeId: Uuid,
  employeeCode: t.String({ maxLength: 64 }),
  employeeName: t.String({ maxLength: 128 }),
  departmentName: Nullable(t.String({ maxLength: 128 })),
})

/** `list-own` 單筆：僅核心欄位——查的必然是自己，不需要員工／部門欄位（UI 12）。 */
const OwnAttendanceResultListItemSchema = t.Object({ ...AttendanceResultCoreSchema })

/** `list` 支援的排序欄位：依日期或依員工工號。 */
const ATTENDANCE_RESULT_LIST_SORT_FIELDS = ['workDate', 'employeeCode'] as const

/** `list-own` 只支援依日期排序——範圍固定是本人，沒有「依員工分組」的需求。 */
const ATTENDANCE_RESULT_LIST_OWN_SORT_FIELDS = ['workDate'] as const

const AttendanceResultListSearchSchema = t.Object({
  yearMonth: YearMonth,
  departmentId: t.Optional(Uuid),
  employeeId: t.Optional(Uuid),
})

/** `list-own` 的搜尋回聲：只有 `yearMonth`——範圍固定是呼叫者本人，沒有其他可篩選欄位。 */
const OwnAttendanceResultListSearchSchema = t.Object({ yearMonth: YearMonth })

/**
 * 每支端點都可能出現的非業務回應（比照 `attendance-records.routes.ts`）。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼：`401` 未登入、`403` 無權限、`500` 系統
 * 錯誤，三者都與業務邏輯無關，`data` 恆為 `null`、`errors` 恆為空陣列（§1.3）。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/** 沒有業務錯誤時仍要寫出清單（§1.8.3），這裡把它帶進 OpenAPI 的說明文字。 */
const describeErrorCodes = (codes: readonly string[]): string =>
  codes.length === 0 ? '本端點不會吐出任何業務錯誤碼。' : `可能的業務錯誤碼：${codes.join('、')}`

export const attendanceResultsRoutes = (dependencies: AttendanceResultsDependencies) =>
  new Elysia({ name: 'attendance-results-routes' })
    .use(requestContext)
    .post(
      '/attendance/results/recalculate-no-schedule',
      (context) => handleRecalculateAllNoScheduleAttendanceResults(dependencies, context),
      {
        body: t.Object({ ...BaseRequest, cmd: t.Literal('attendance.results.recalculate-no-schedule') }),
        response: {
          200: envelope(RecalculateAllNoScheduleData),
          ...CommonFailureResponses,
        },
        detail: {
          summary: '重算全部未排班（NO_SCHEDULE）判定結果',
          description: `${describeErrorCodes(ATTENDANCE_RESULTS_RECALCULATE_NO_SCHEDULE_ERROR_CODES)} 依呼叫者所屬公司範圍批次重算；排班（第 3 層）上線後用來把歷史紀錄換算成對照班表的判定。固定三次資料庫往返，不隨待重算筆數增加。`,
        },
      },
    )
    .post('/attendance/results/list', (context) => handleAttendanceResultsList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.results.list'),
        yearMonth: YearMonth,
        departmentId: t.Optional(Uuid),
        employeeId: t.Optional(Uuid),
        ...PageRequest,
        sort: t.Optional(sortRequest(ATTENDANCE_RESULT_LIST_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(AttendanceResultListSearchSchema, AttendanceResultListItemSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '全體出勤（依年月查詢，公司範圍，可依部門／人員篩選）',
        description: `${describeErrorCodes(ATTENDANCE_RESULTS_LIST_ERROR_CODES)} 部門顯示與篩選依查詢當日（每一列各自的 work_date）的有效部門歷史，不是員工目前部門；查不到部門歸屬的列仍會顯示，departmentName 為 null。列表恆不含座標，地址反查目前暫停（計畫 §4.8），clockInAddress／clockOutAddress 目前恆為 null。固定兩次資料庫往返（分頁列一次、總筆數一次），不隨頁面筆數或公司規模增加。`,
      },
    })
    .post('/attendance/results/list-own', (context) => handleAttendanceResultsListOwn(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.results.list-own'),
        yearMonth: YearMonth,
        ...PageRequest,
        sort: t.Optional(sortRequest(ATTENDANCE_RESULT_LIST_OWN_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(OwnAttendanceResultListSearchSchema, OwnAttendanceResultListItemSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '我的出勤（依年月查詢，本人範圍）',
        description: `${describeErrorCodes(ATTENDANCE_RESULTS_LIST_OWN_ERROR_CODES)} 範圍固定為 token 推出的本人，不接受 employeeId；呼叫者沒有連結員工時回空清單。列表恆不含座標，地址反查目前暫停（計畫 §4.8），clockInAddress／clockOutAddress 目前恆為 null。固定兩次資料庫往返，不隨頁面筆數增加。`,
      },
    })
