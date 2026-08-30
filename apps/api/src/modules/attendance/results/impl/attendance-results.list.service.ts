/**
 * 業務動作：全體出勤（公司範圍，UI 09；計畫 §5 Stage 7）。純轉手到 repository——這支查詢沒有
 * 業務規則要檢查（權限碼由路由層依路徑機械推導的 `attendance.results.list` 把關，見
 * `attendance-results.routes.ts`），篩選條件（部門／人員）指到查無資料、跨公司或已刪除的目標時，
 * 依 `sundial-backend` skill api-design.md §4「一律比照查無資料回空清單，不新增錯誤碼」，因此
 * 宣告的業務錯誤清單是空陣列。
 *
 * **純查詢，不開交易**（§4.4）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceResultsContext } from '../domain/attendance-result-context.ts'
import type { ListAttendanceResultsPage, ListAttendanceResultsQuery } from '../domain/attendance-result-list-view.ts'
import { listAttendanceResults as listAttendanceResultsFromRepository } from '../attendance-results.repository.ts'

export const listAttendanceResults = async (
  context: AttendanceResultsContext,
  query: ListAttendanceResultsQuery,
): Promise<ServiceResult<ListAttendanceResultsPage>> =>
  succeed(await listAttendanceResultsFromRepository(context.db, context.companyId, query))
