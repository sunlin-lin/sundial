/**
 * 打卡的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換，由身分驗證 middleware 自己推導。
 * 五支端點對應五個權限碼：`attendance.records.create`／`.revoke`／`.revoke-other`／`.get`／
 * `.list-by-date`。`attendance.records.view-all`（計畫 §4.2 的細粒度旗標，供 `get` 判斷座標
 * 可見範圍）**不是任何端點自己的權限碼**，不會出現在這裡——它是一個獨立、不對應任何路徑的
 * 可指派權限碼，由 `get.service.ts` 在執行期查詢並比對，見該檔與 `domain/
 * attendance-record-visibility.ts` 檔頭。
 *
 * ---
 *
 * ## `get` 的座標欄位：`t.Optional` 疊 `t.Union([Number, Null])`
 *
 * 計畫 §4.2：**同一支 `get` 端點依呼叫者身分回傳不同欄位**，回應 schema 必須讓「鍵不存在」與
 * 「鍵存在但值是 `null`」分別對應到不同語意——`t.Optional` 表達前者（沒有權限看別人的座標），
 * `t.Union([t.Number(), t.Null()])` 表達後者（有權限看，但這筆打卡本來就沒有 GPS）。
 * `create`／`revoke`／`revoke-other` 三支端點的座標欄位**沒有這一層 `t.Optional`**——這三支的
 * 回應恆是呼叫者自己的打卡，或已經通過 `revoke-other` 權限碼把關的他人打卡，兩種情況都落在
 * 「有權限看」的分支，見 `attendance-records.handler.ts` 檔頭。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  IsoDate,
  Nullable,
  PageRequest,
  paginationResponse,
  Reason,
  sortRequest,
  TaipeiDateTime,
  Uuid,
} from '../../../shared/field-schemas.ts'
import {
  handleAttendanceRecordCreate,
  handleAttendanceRecordGet,
  handleAttendanceRecordListByDate,
  handleAttendanceRecordRevoke,
  handleAttendanceRecordRevokeOther,
  type AttendanceRecordsDependencies,
} from './attendance-records.handler.ts'
import { ATTENDANCE_RECORDS_ENDPOINT_ERRORS, describeAttendanceRecordErrors } from './attendance-records.errors.ts'

/** 打卡事件類型。值必須與 `db/schema/attendance-records.ts` 的 `AttendanceTypeCode` 相同。 */
const AttendanceTypeCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/** 打卡來源類型。值必須與 `db/schema/attendance-records.ts` 的 `AttendanceSourceTypeCode` 相同。 */
const AttendanceSourceTypeCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/** 座標。API 回應為 JSON number，不維持 decimal 字串——理由見計畫 §4.2、`db/schema/
 * attendance-records.ts` 檔頭。 */
const Latitude = t.Number({ minimum: -90, maximum: 90 })
const Longitude = t.Number({ minimum: -180, maximum: 180 })
const AccuracyMeters = t.Integer({ minimum: 0 })

/** `create`／`revoke`／`revoke-other` 共用的明細形狀：**恆含座標**（見檔頭）。 */
const AttendanceRecordDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  employmentId: Uuid,
  workDate: IsoDate,
  attendanceTypeCode: AttendanceTypeCodeSchema,
  sourceTypeCode: AttendanceSourceTypeCodeSchema,
  clockedAt: TaipeiDateTime,
  latitude: Nullable(Latitude),
  longitude: Nullable(Longitude),
  accuracyMeters: Nullable(AccuracyMeters),
  address: Nullable(t.String({ maxLength: 255 })),
  revokedAt: Nullable(TaipeiDateTime),
  revokedBy: Nullable(Uuid),
  revokeReason: Nullable(t.String({ maxLength: 500 })),
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/**
 * `get` 專用形狀：`latitude`／`longitude` 用 `t.Optional(t.Union([t.Number(), t.Null()]))`
 * ——對應到生成型別 `latitude?: number | null`（計畫 §4.2 原文）。
 */
const AttendanceRecordGetDetailSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  employmentId: Uuid,
  workDate: IsoDate,
  attendanceTypeCode: AttendanceTypeCodeSchema,
  sourceTypeCode: AttendanceSourceTypeCodeSchema,
  clockedAt: TaipeiDateTime,
  latitude: t.Optional(t.Union([Latitude, t.Null()])),
  longitude: t.Optional(t.Union([Longitude, t.Null()])),
  accuracyMeters: Nullable(AccuracyMeters),
  address: Nullable(t.String({ maxLength: 255 })),
  revokedAt: Nullable(TaipeiDateTime),
  revokedBy: Nullable(Uuid),
  revokeReason: Nullable(t.String({ maxLength: 500 })),
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** `list-by-date` 單筆：**恆不含座標**（計畫 §4.2：列表一律不回座標）。 */
const AttendanceRecordListItemSchema = t.Object({
  id: Uuid,
  employeeId: Uuid,
  employeeCode: t.String({ maxLength: 64 }),
  employeeName: t.String({ maxLength: 128 }),
  departmentName: Nullable(t.String({ maxLength: 128 })),
  employmentId: Uuid,
  workDate: IsoDate,
  attendanceTypeCode: AttendanceTypeCodeSchema,
  sourceTypeCode: AttendanceSourceTypeCodeSchema,
  clockedAt: TaipeiDateTime,
  address: Nullable(t.String({ maxLength: 255 })),
  revokedAt: Nullable(TaipeiDateTime),
  revokedBy: Nullable(Uuid),
  revokeReason: Nullable(t.String({ maxLength: 500 })),
})

const AttendanceRecordListSearchSchema = t.Object({
  date: IsoDate,
  departmentId: t.Optional(Uuid),
  employeeId: t.Optional(Uuid),
})

/** `list-by-date` 只支援依打卡時刻排序——這一頁服務的是「當天逐筆事件」，不需要更多排序欄位。 */
const ATTENDANCE_RECORD_LIST_SORT_FIELDS = ['clockedAt'] as const

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
 * 打卡的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）：
 *   `bun run gen:api` 必須能在資料庫未連線的情況下產出契約，否則新人的第一天就會卡在這裡。
 */
export const attendanceRecordsRoutes = (dependencies: AttendanceRecordsDependencies) =>
  new Elysia({ name: 'attendance-records-routes' })
    .use(requestContext)
    .post('/attendance/records/create', (context) => handleAttendanceRecordCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.records.create'),
        attendanceTypeCode: AttendanceTypeCodeSchema,
        latitude: t.Optional(t.Union([Latitude, t.Null()])),
        longitude: t.Optional(t.Union([Longitude, t.Null()])),
        accuracyMeters: t.Optional(t.Union([AccuracyMeters, t.Null()])),
      }),
      response: {
        200: envelope(AttendanceRecordDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '打卡（上班卡或下班卡）',
        description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.create)} employeeId／employmentId 不是輸入，由 token 推出的操作者身分決定；work_date 由配對決定，不是打卡當日。`,
      },
    })
    .post('/attendance/records/revoke', (context) => handleAttendanceRecordRevoke(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.records.revoke'),
        recordId: Uuid,
        reason: Reason,
      }),
      response: {
        200: envelope(AttendanceRecordDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '本人撤銷自己的打卡（軟刪除，不寫稽核）',
        description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.revoke)} 不接受 employeeId：只能撤銷 token 推出的本人記錄，指向別人的記錄視同找不到。`,
      },
    })
    .post('/attendance/records/revoke-other', (context) => handleAttendanceRecordRevokeOther(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.records.revoke-other'),
        recordId: Uuid,
        reason: Reason,
      }),
      response: {
        200: envelope(AttendanceRecordDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '他人撤銷別人的打卡（標記作廢，寫 audit_logs）',
        description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.revokeOther)} 需要 attendance.records.revoke-other 權限碼；成功後寫入一筆 audit_logs（座標三欄為 presence 級）。`,
      },
    })
    .post('/attendance/records/get', (context) => handleAttendanceRecordGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('attendance.records.get'), recordId: Uuid }),
      response: {
        // 查無資料（含跨公司）回 `data: null`，不是錯誤（§1.3、§3.2）。
        200: envelope(Nullable(AttendanceRecordGetDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單筆打卡明細（座標依呼叫者身分決定回不回，見本檔檔頭）',
        description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.get)} 查自己的一律含 latitude／longitude 鍵；查別人的需要 attendance.records.view-all 或 attendance.records.revoke-other 權限碼，否則這兩把鍵完全不出現（不是出現且為 null）。`,
      },
    })
    .post('/attendance/records/list-by-date', (context) => handleAttendanceRecordListByDate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.records.list-by-date'),
        date: IsoDate,
        departmentId: t.Optional(Uuid),
        employeeId: t.Optional(Uuid),
        ...PageRequest,
        sort: t.Optional(sortRequest(ATTENDANCE_RECORD_LIST_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(AttendanceRecordListSearchSchema, AttendanceRecordListItemSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '依日期查全公司打卡（分頁，含已撤銷，供每日全員打卡明細使用）',
        description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.listByDate)} 列表恆不含座標，只顯示反查地址；departmentId／employeeId 比對的都是查詢當天的資料。`,
      },
    })
