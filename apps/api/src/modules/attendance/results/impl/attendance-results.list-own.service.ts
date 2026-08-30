/**
 * 業務動作：我的出勤（本人範圍，UI 12；計畫 §5 Stage 7）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：由 `company_user → employee_id` 解出「自己」
 * 是哪個員工，不接受呼叫端指定 `employeeId`——比照 `attendance/records` 的 `revoke`（本人）與
 * `list-own-by-date`，以及 `sessions-main.logout-all.service.ts` 的既有先例。
 *
 * **呼叫者沒有連結員工（純協作者帳號）時回空清單，不是錯誤**：這是查詢類端點，「沒有自己的資料」
 * 與「查無資料」是同一件事（§3.1.3），不需要另立一個業務錯誤碼。
 *
 * **純查詢，不開交易**（§4.4）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceResultsContext } from '../domain/attendance-result-context.ts'
import type {
  ListOwnAttendanceResultsPage,
  ListOwnAttendanceResultsQuery,
} from '../domain/attendance-result-list-view.ts'
import {
  findEmployeeIdForCompanyUser,
  listOwnAttendanceResults as listOwnAttendanceResultsFromRepository,
} from '../attendance-results.repository.ts'

export const listOwnAttendanceResults = async (
  context: AttendanceResultsContext,
  query: ListOwnAttendanceResultsQuery,
): Promise<ServiceResult<ListOwnAttendanceResultsPage>> => {
  const employeeId = await findEmployeeIdForCompanyUser(context.db, context.companyId, context.operatorCompanyUserId)
  if (employeeId === null) return succeed({ items: [], totalCount: 0 })

  return succeed(await listOwnAttendanceResultsFromRepository(context.db, context.companyId, employeeId, query))
}
