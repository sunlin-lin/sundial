/**
 * 業務動作：依日期查全公司打卡（分頁），計畫 §4.7。純轉手到 repository——這支查詢沒有業務規則
 * 要檢查（權限碼由路由層依路徑機械推導的 `attendance.records.list-by-date` 把關，見
 * `attendance-records.routes.ts`），因此宣告的業務錯誤清單是空陣列（`ATTENDANCE_RECORDS_
 * ENDPOINT_ERRORS.listByDate`）。
 *
 * **純查詢，不開交易**（§4.4）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type {
  ListAttendanceRecordsByDatePage,
  ListAttendanceRecordsByDateQuery,
} from '../domain/attendance-record-model.ts'
import { listAttendanceRecordsByDate as listAttendanceRecordsByDateFromRepository } from '../attendance-records.repository.ts'

export const listAttendanceRecordsByDate = async (
  context: AttendanceRecordsContext,
  query: ListAttendanceRecordsByDateQuery,
): Promise<ServiceResult<ListAttendanceRecordsByDatePage>> =>
  succeed(await listAttendanceRecordsByDateFromRepository(context.db, context.companyId, query))
