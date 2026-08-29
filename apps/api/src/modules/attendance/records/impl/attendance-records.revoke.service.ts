/**
 * 業務動作：本人撤銷自己的打卡（軟刪除，不寫稽核，計畫 §4.3、§4.3.1）。
 *
 * **範圍來自 token 推出的身分，不是 request body**：input 只有 `recordId`／`reason`，
 * **不接受呼叫端指定 `employeeId`**——比照 `sessions-main.logout-all.service.ts` 的先例。
 * 撈出這筆記錄後比對它的 `employee_id` 是否等於「目前登入身分透過 `company_users → employee_id`
 * 推出的本人」，不相等就視同找不到這筆記錄（回同一則 `not-found`），不讓呼叫端從錯誤訊息分辨出
 * 「這筆記錄存在、只是不是你的」。
 *
 * **檢查順序**：目標存在且是本人 → 尚未撤銷 → 若是上班卡，其後是否已有有效下班卡（字典「已確認
 * 的 Dashboard 打卡與撤銷」：需先撤銷下班卡）→ 該工作日是否已被薪資結算鎖定（`isPeriodLocked`
 * 樁，見 `domain/attendance-record-period-lock.ts`）→ 條件式 `UPDATE`。
 *
 * **不寫 `audit_logs`**：`revoked_by`／`revoked_at`／`revoke_reason` 三欄已完整回答「誰、何時、
 * 為何撤銷」，本人對自己資料的軟刪除性質上是自我更正（計畫 §4.6）。
 *
 * **不需要 `FOR UPDATE`**：撤銷是條件式 `UPDATE`（`WHERE revoked_at IS NULL AND id = ?`），
 * 影響列數為 0 就回衝突，不需要額外上鎖（計畫 §4.5）。
 *
 * **撤銷成功後，在同一筆交易內呼叫 Stage 4 的重算**（計畫 §4.3.1：兩種撤銷之後都要重算
 * `attendance_results`，沒有差別；09／10 的驗收明文要求）。呼叫 `recalculateAttendanceResultForWorkDay`
 * 而不是自己開一筆新交易——撤銷與重算若各自開交易，會出現「撤銷已 COMMIT、重算那筆交易卻失敗」
 * 的縫隙，見該函式檔頭。直接 import 同一個大目錄底下 `results` 次目錄的 `*.service.ts`，不經過
 * `modules/attendance/index.ts`（那是給其他大目錄用的出口），比照本檔已經在用的
 * `../../settings/attendance-settings.service.ts` 同一種同大目錄內的引用方式。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { recalculateAttendanceResultForWorkDay } from '../../results/attendance-results.service.ts'
import { isPeriodLocked } from '../domain/attendance-record-period-lock.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type { AttendanceRecordDetail, RevokeOwnAttendanceRecordInput } from '../domain/attendance-record-model.ts'
import {
  attendanceRecordAlreadyRevoked,
  attendanceRecordClockOutMustBeRevokedFirst,
  attendanceRecordNotFound,
  attendanceRecordPeriodLocked,
} from '../attendance-records.errors.ts'
import {
  findAttendanceRecordDetail,
  findEmployeeIdForCompanyUser,
  findValidPunchOnDate,
  markAttendanceRecordRevoked,
} from '../attendance-records.repository.ts'

const revokeOwnAttendanceRecordInTransaction = async (
  tx: TransactionRunner,
  context: AttendanceRecordsContext,
  input: RevokeOwnAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  const now = context.clock.now()

  const [requesterEmployeeId, record] = await Promise.all([
    findEmployeeIdForCompanyUser(tx, context.companyId, context.operatorCompanyUserId),
    findAttendanceRecordDetail(tx, context.companyId, input.recordId),
  ])

  // 目標不存在，或存在但不是呼叫者本人的——回同一則錯誤（見檔頭）。
  if (record === null || requesterEmployeeId === null || record.employeeId !== requesterEmployeeId) {
    return fail([attendanceRecordNotFound()])
  }
  if (record.revokedAt !== null) return fail([attendanceRecordAlreadyRevoked()])

  if (record.attendanceTypeCode === AttendanceTypeCode.ClockIn) {
    const dependentClockOut = await findValidPunchOnDate(
      tx,
      context.companyId,
      record.employmentId,
      record.workDate,
      AttendanceTypeCode.ClockOut,
    )
    if (dependentClockOut !== null) return fail([attendanceRecordClockOutMustBeRevokedFirst()])
  }

  // ★ 這是一根樁，不是真的檢查——見 `domain/attendance-record-period-lock.ts` 檔頭。
  if (isPeriodLocked(context.companyId, record.workDate)) return fail([attendanceRecordPeriodLocked()])

  const affectedRows = await markAttendanceRecordRevoked(tx, context.companyId, input.recordId, {
    revokedBy: context.operatorCompanyUserId,
    revokeReason: input.reason,
    revokedSeq: context.clock.epochMs(),
    now,
  })
  if (affectedRows === 0) return fail([attendanceRecordAlreadyRevoked()])

  // ★ 同一筆交易內重算（見檔頭）：撤銷影響的是 record.employeeId／record.workDate 這一天的判定，
  // 不是撤銷者自己的今天——撤銷本人過去某一天的打卡時，重算對象一樣是那一天，不是「現在」。
  await recalculateAttendanceResultForWorkDay(
    tx,
    context.companyId,
    { employeeId: record.employeeId, workDate: record.workDate },
    now,
  )

  const updated = await findAttendanceRecordDetail(tx, context.companyId, input.recordId)
  if (updated === null) {
    throw new Error(`打卡記錄 ${input.recordId} 撤銷後於同一交易內讀不回來`)
  }
  return succeed(updated)
}

export const revokeOwnAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: RevokeOwnAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> =>
  context.db.transaction((tx) => revokeOwnAttendanceRecordInTransaction(tx, context, input))
