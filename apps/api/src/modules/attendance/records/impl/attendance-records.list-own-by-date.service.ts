/**
 * 業務動作：查詢本人某一天的打卡記錄（分頁），Stage 5 補的端點（缺口二，見
 * `attendance-records.routes.ts` 端點說明的完整推論）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：由 `company_user → employee_id` 解出
 * 「自己」是哪個員工，不接受呼叫端指定 `employeeId`——比照 `revoke`（本人）與
 * `sessions-main.logout-all.service.ts` 的既有先例。
 *
 * **呼叫者沒有連結員工（純協作者帳號）時回空清單，不是錯誤**：這是查詢類端點，「沒有自己的資料」
 * 與「查無資料」是同一件事（§3.1.3），不需要另立一個業務錯誤碼。
 *
 * **純查詢，不開交易**（§4.4）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type {
  ListOwnAttendanceRecordsByDatePage,
  ListOwnAttendanceRecordsByDateQuery,
} from '../domain/attendance-record-model.ts'
import {
  findEmployeeIdForCompanyUser,
  listOwnAttendanceRecordsByDate as listOwnAttendanceRecordsByDateFromRepository,
} from '../attendance-records.repository.ts'

export const listOwnAttendanceRecordsByDate = async (
  context: AttendanceRecordsContext,
  query: ListOwnAttendanceRecordsByDateQuery,
): Promise<ServiceResult<ListOwnAttendanceRecordsByDatePage>> => {
  const employeeId = await findEmployeeIdForCompanyUser(context.db, context.companyId, context.operatorCompanyUserId)
  if (employeeId === null) return succeed({ items: [], totalCount: 0 })

  return succeed(await listOwnAttendanceRecordsByDateFromRepository(context.db, context.companyId, employeeId, query))
}
