/**
 * 出勤判定結果的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 本階段（Stage 4）只有一支端點：重算全部 `NO_SCHEDULE` 紀錄。查詢類端點（依員工／依日期查判定
 * 結果，供「全體出勤」「我的出勤」使用）排在 Stage 7，本輪不開。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。權限碼也不在這裡宣告（§5.2.2）：`attendance.results.
 * recalculate-no-schedule` 由路徑機械推導，由身分驗證 middleware 自己算出來。
 */
import { Elysia, t } from 'elysia'
import { Type } from '@sinclair/typebox'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest } from '../../../shared/field-schemas.ts'
import {
  handleRecalculateAllNoScheduleAttendanceResults,
  type AttendanceResultsDependencies,
} from './attendance-results.handler.ts'
import { ATTENDANCE_RESULTS_RECALCULATE_NO_SCHEDULE_ERROR_CODES } from './attendance-results.errors.ts'

// `recalculatedCount` 是回應方向的欄位（後端算出來的重算筆數，不是使用者輸入），一律用 TypeBox
// 原生的 `Type.Integer`，不是 Elysia 可強制轉型的 `t.Integer`（理由見 `check-response-coercion.ts`
// 檔頭與 `shared/field-schemas.ts` 的 `Pagination` 檔頭）。
const RecalculateAllNoScheduleData = t.Object({ recalculatedCount: Type.Integer({ minimum: 0 }) })

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
