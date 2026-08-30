/**
 * 業務動作：員工撤回自己的補打卡申請（UI 13「已撤回」）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：input 只有 `requestId`，**不接受呼叫端指定
 * `employeeId`**——比照 `attendance/records` 的 `revoke`（本人）與
 * `sessions-main.logout-all.service.ts` 的既有先例。撈出這筆申請後比對 `employee_id` 是否等於
 * 「目前登入身分透過 `company_users → employee_id` 推出的本人」，不相等就視同找不到（回同一則
 * `not-found`），不讓呼叫端從錯誤訊息分辨出「這筆申請存在、只是不是你的」。
 *
 * **只有待審核申請可以撤回**（UI 13、字典「已確認流程與約束」）：已核准、已退回、已撤回都不能
 * 再撤回一次，回 `not-withdrawable`。這個判斷同時交給讀取時的比對與條件式 UPDATE 兩層——條件式
 * UPDATE 的 `WHERE status_code = Pending` 是最終防線，兩個人同時撤回同一筆申請時，先到的成功、
 * 後到的影響 0 列，回同一則錯誤（比照 `attendance/records` 的 `markAttendanceRecordRevoked`）。
 *
 * **撤回後不建立正式打卡，也不重算 `attendance_results`**：申請本身從未建立過正式打卡（見
 * `attendance-correction-requests.submit.service.ts` 檔頭與計畫 §4.6「這一輪要確認的是：申請
 * 本身不寫入 attendance_records」），撤回自然也沒有任何要撤銷的正式紀錄或要重算的判定結果——這與
 * `attendance/records` 的 `revoke`（撤銷已存在的正式打卡，因此要重算）是完全不同的資料狀態。
 *
 * **不寫稽核，理由與 `submit` 相同**：員工對自己申請的自我撤回，性質上是自我更正，不落在五類
 * 必稽核操作裡；本表的 `status_code`／`updated_at` 已經回答「這筆現在是不是被撤回了、什麼時候
 * 變成這樣」，UI 13「已撤回」段落也只要求狀態與時間，沒有要求記錄撤回原因。
 *
 * **不需要交易**：只有一次條件式 UPDATE，沒有第二個寫入動作需要與它綁在同一個原子單位裡。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { AttendanceCorrectionRequestsContext } from '../domain/attendance-correction-request-context.ts'
import type {
  AttendanceCorrectionRequestDetail,
  WithdrawAttendanceCorrectionRequestInput,
} from '../domain/attendance-correction-request-model.ts'
import {
  attendanceCorrectionRequestNotFound,
  attendanceCorrectionRequestNotWithdrawable,
} from '../attendance-correction-requests.errors.ts'
import {
  findAttendanceCorrectionRequestDetail,
  findEmployeeIdForCompanyUser,
  markAttendanceCorrectionRequestWithdrawn,
} from '../attendance-correction-requests.repository.ts'
import { AttendanceCorrectionRequestStatusCode } from '../../../../db/schema/index.ts'

export const withdrawAttendanceCorrectionRequest = async (
  context: AttendanceCorrectionRequestsContext,
  input: WithdrawAttendanceCorrectionRequestInput,
): Promise<ServiceResult<AttendanceCorrectionRequestDetail>> => {
  const [requesterEmployeeId, record] = await Promise.all([
    findEmployeeIdForCompanyUser(context.db, context.companyId, context.operatorCompanyUserId),
    findAttendanceCorrectionRequestDetail(context.db, context.companyId, input.requestId),
  ])

  // 目標不存在，或存在但不是呼叫者本人的——回同一則錯誤（見檔頭）。
  if (record === null || requesterEmployeeId === null || record.employeeId !== requesterEmployeeId) {
    return fail([attendanceCorrectionRequestNotFound()])
  }
  if (record.statusCode !== AttendanceCorrectionRequestStatusCode.Pending) {
    return fail([attendanceCorrectionRequestNotWithdrawable()])
  }

  const now = context.clock.now()
  const affectedRows = await markAttendanceCorrectionRequestWithdrawn(context.db, context.companyId, input.requestId, {
    // 撤回流水號，與 `attendance_records.revoked_seq` 同一種作法：撤回當下的 epoch 毫秒，
    // 同一筆申請只會被撤回一次，因此不可能與自己碰撞。
    pendingSeq: context.clock.epochMs(),
    now,
  })
  if (affectedRows === 0) return fail([attendanceCorrectionRequestNotWithdrawable()])

  const updated = await findAttendanceCorrectionRequestDetail(context.db, context.companyId, input.requestId)
  if (updated === null) {
    throw new Error(`補打卡申請 ${input.requestId} 撤回後讀不回來`)
  }
  return succeed(updated)
}
