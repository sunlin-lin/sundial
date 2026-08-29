/**
 * 出勤設定的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換（`/attendance/settings/get` →
 * `attendance.settings.get`），由身分驗證 middleware 自己推導。
 *
 * ---
 *
 * ## 只有兩支端點，沒有 `create`／`list`／`delete`
 *
 * `attendance_settings` 是「一間公司一筆」的單例表（完整推論見 `db/schema/
 * attendance-settings.ts` 檔頭）。`update` 在公司從未存過設定時等同「建立」（`impl/
 * attendance-settings.update.service.ts` 檔頭），前端永遠呼叫同一支，不需要先判斷該叫
 * `create` 還是 `update`。
 *
 * ## `get` 沒有任何業務欄位
 *
 * 查詢範圍完全由已驗證身分的公司範圍決定，比照 `departments-main.routes.ts` 的 `tree` 端點
 * ——「這支端點的業務輸入就是沒有輸入」與「忘了宣告輸入」在型別上必須長得不一樣。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, Nullable, TaipeiDateTime, Uuid } from '../../../shared/field-schemas.ts'
import {
  handleAttendanceSettingsGet,
  handleAttendanceSettingsUpdate,
  type AttendanceSettingsDependencies,
} from './attendance-settings.handler.ts'
import { ATTENDANCE_SETTINGS_ENDPOINT_ERRORS, describeAttendanceSettingsErrors } from './attendance-settings.errors.ts'

/** 六個開關欄位，`update` 的 request body 與回應共用同一組名稱（僅回應多了 `id`／時間戳）。 */
const AttendanceSettingsToggleFields = {
  requireClockInBeforeClockOut: t.Boolean(),
  allowEmployeeCancellation: t.Boolean(),
  allowCorrectionRequest: t.Boolean(),
  correctionRequiresApproval: t.Boolean(),
  gpsEnabled: t.Boolean(),
  gpsRequired: t.Boolean(),
} as const

const AttendanceSettingsDetailSchema = t.Object({
  id: Uuid,
  ...AttendanceSettingsToggleFields,
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

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

/** 業務錯誤的回應形狀。409 在 envelope 上是 `code='300'`（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
} as const

/**
 * 出勤設定的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）：
 *   `bun run gen:api` 必須能在資料庫未連線的情況下產出契約，否則新人的第一天就會卡在這裡。
 */
export const attendanceSettingsRoutes = (dependencies: AttendanceSettingsDependencies) =>
  new Elysia({ name: 'attendance-settings-routes' })
    .use(requestContext)
    .post('/attendance/settings/get', (context) => handleAttendanceSettingsGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('attendance.settings.get') }),
      response: {
        // 尚未存過設定回 `data: null`，不是錯誤（§1.3）。別家公司的設定同樣查不到（§3.2，
        // 公司範圍由 TenantDatabase 保證，不存在「跨公司查到別人設定」這種情況）。
        200: envelope(Nullable(AttendanceSettingsDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢目前的出勤設定',
        description: `${describeAttendanceSettingsErrors(ATTENDANCE_SETTINGS_ENDPOINT_ERRORS.get)} 尚未設定過時 data 為 null，前端不得以此當成「已設定為預設值」。`,
      },
    })
    .post('/attendance/settings/update', (context) => handleAttendanceSettingsUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('attendance.settings.update'),
        ...AttendanceSettingsToggleFields,
      }),
      response: {
        200: envelope(AttendanceSettingsDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改出勤設定（尚未存過設定時，本端點即建立第一筆）',
        description: describeAttendanceSettingsErrors(ATTENDANCE_SETTINGS_ENDPOINT_ERRORS.update),
      },
    })
