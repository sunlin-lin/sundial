/**
 * 業務動作：查詢本人的補打卡申請（UI 13「查詢與列表」）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：由 `company_user → employee_id` 解出「自己」
 * 是哪個員工，不接受呼叫端指定 `employeeId`（比照 `attendance/records` 的 `list-own-by-date`、
 * `attendance/results` 的 `list-own`）。
 *
 * **呼叫者沒有連結員工（純協作者帳號）時回空清單，不是錯誤**：這是查詢類端點，「沒有自己的資料」
 * 與「查無資料」是同一件事（§3.1.3）。
 *
 * **純查詢，不開交易**（§4.4）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceCorrectionRequestsContext } from '../domain/attendance-correction-request-context.ts'
import type {
  ListOwnAttendanceCorrectionRequestsPage,
  ListOwnAttendanceCorrectionRequestsQuery,
} from '../domain/attendance-correction-request-model.ts'
import {
  findEmployeeIdForCompanyUser,
  listOwnAttendanceCorrectionRequests as listOwnAttendanceCorrectionRequestsFromRepository,
} from '../attendance-correction-requests.repository.ts'

export const listOwnAttendanceCorrectionRequests = async (
  context: AttendanceCorrectionRequestsContext,
  query: ListOwnAttendanceCorrectionRequestsQuery,
): Promise<ServiceResult<ListOwnAttendanceCorrectionRequestsPage>> => {
  const employeeId = await findEmployeeIdForCompanyUser(context.db, context.companyId, context.operatorCompanyUserId)
  if (employeeId === null) return succeed({ items: [], totalCount: 0 })

  return succeed(
    await listOwnAttendanceCorrectionRequestsFromRepository(context.db, context.companyId, employeeId, query),
  )
}
