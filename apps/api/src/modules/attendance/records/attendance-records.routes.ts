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
 * 六支端點對應六個權限碼：`attendance.records.create`／`.revoke`／`.revoke-other`／`.get`／
 * `.list-by-date`／`.list-own-by-date`。`attendance.records.view-all`（計畫 §4.2 的細粒度旗標，
 * 供 `get` 判斷座標可見範圍）**不是任何端點自己的權限碼**，不會出現在這裡——它是一個獨立、不
 * 對應任何路徑的可指派權限碼，由 `get.service.ts` 在執行期查詢並比對，見該檔與 `domain/
 * attendance-record-visibility.ts` 檔頭。
 *
 * ---
 *
 * ## `list-own-by-date`：Dashboard 缺口二，為什麼不能沿用 `list-by-date` 的權限碼
 *
 * Stage 5 Dashboard「今日打卡狀態」原本靠本次瀏覽階段內累積推導，重新整理頁面就歸零，即使今天
 * 稍早已經打過卡。現有端點都不適用：`get` 要已知 `recordId`；`list-by-date` 的權限碼
 * （`attendance.records.list-by-date`）在架構意圖上是人事／主管專用（見 0039 seed migration
 * 的節點說明：「每日全員打卡明細（Stage 6）使用」），拿它當自助查詢會把 Dashboard 綁在一個不
 * 保證每個員工都有的權限碼上。
 *
 * 因此新開一支獨立端點與獨立權限碼 `attendance.records.list-own-by-date`：**範圍固定為 token
 * 推出的呼叫者本人**（service 內部由 `company_user → employee_id` 解出，不接受呼叫端指定
 * `employeeId`，比照 `revoke` 與 `sessions-main.logout-all.service.ts` 的既有先例），因此可以
 * 安全地配給每一位一般員工的角色，不必依賴人事／主管才有的權限碼。
 *
 * **日期參數收一般日期，不是固定查今天**：Dashboard 現在只需要今天，但同一支查詢日後「我的出勤」
 * （Stage 7）查別天會直接用得上；收固定日期只服務得了 Dashboard 一種情境，日後多開一支「查別天」
 * 的端點才是真正的白工，兩者的授權與範圍規則完全相同，沒有理由拆成兩支。
 *
 * **列表恆不含座標，與 `list-by-date` 適用同一條規則，不是計畫 §4.2「看自己的一律看得到」的例外**
 * ：那一條講的是 `get` 這種明細端點——依呼叫者身分決定「看不看得到」是一個獨立的判斷軸線，只套用
 * 在明細端點上；「列表一律不輸出座標」是另一條獨立的規則，套用在所有列表端點上，不分呼叫者是誰、
 * 查的是不是自己的資料。這支端點是列表形狀（分頁、多筆），因此落在後一條規則裡，兩條規則管的是
 * 不同的軸線，套在同一支端點上不衝突——即使查的是本人資料，端點形狀仍是決定要不要輸出座標的唯一
 * 依據。需要座標時，呼叫端可以拿這支列表回來的 `id` 再打一次 `get`（明細端點才回座標）。
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
  handleAttendanceRecordListOwnByDate,
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

/** `list-own-by-date` 單筆：**恆不含座標**，也不含員工姓名／工號／部門（查的必然是自己，見
 * `attendance-records.routes.ts` 檔頭「`list-own-by-date`」節與 `domain/
 * attendance-record-model.ts` 的 `OwnAttendanceRecordListItem` 檔頭）。 */
const OwnAttendanceRecordListItemSchema = t.Object({
  id: Uuid,
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

/** `list-own-by-date` 的搜尋回聲：只有 `date`——範圍固定是呼叫者本人，沒有其他可篩選欄位。 */
const OwnAttendanceRecordListSearchSchema = t.Object({ date: IsoDate })

/** `list-by-date`／`list-own-by-date` 都只支援依打卡時刻排序——這一頁服務的是「當天逐筆事件」，
 * 不需要更多排序欄位。 */
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
    .post(
      '/attendance/records/list-own-by-date',
      (context) => handleAttendanceRecordListOwnByDate(dependencies, context),
      {
        body: t.Object({
          ...BaseRequest,
          cmd: t.Literal('attendance.records.list-own-by-date'),
          date: IsoDate,
          ...PageRequest,
          sort: t.Optional(sortRequest(ATTENDANCE_RECORD_LIST_SORT_FIELDS)),
        }),
        response: {
          200: envelope(paginationResponse(OwnAttendanceRecordListSearchSchema, OwnAttendanceRecordListItemSchema)),
          ...CommonFailureResponses,
        },
        detail: {
          summary: '查詢本人某一天的打卡記錄（分頁，含已撤銷，供 Dashboard 重建今日打卡狀態使用）',
          description: `${describeAttendanceRecordErrors(ATTENDANCE_RECORDS_ENDPOINT_ERRORS.listOwnByDate)} 範圍固定為 token 推出的本人，不接受 employeeId；列表恆不含座標（與 list-by-date 同一條規則），需要座標時改呼叫 get 查單筆明細，見本檔檔頭「list-own-by-date」節。`,
        },
      },
    )
