/**
 * 業務動作：他人撤銷別人的打卡（標記作廢並寫 `audit_logs`，計畫 §4.3、§4.3.1、§4.6）。
 *
 * **授權來自端點自己的權限碼，不在這裡另外檢查**：這支端點的粗粒度權限（`attendance.records.
 * revoke-other`）由路由層依路徑機械推導、經身分驗證 middleware 把關（§5.2）——能呼叫到這支
 * service，代表操作者已經通過那道關卡，本檔不需要再查一次權限碼。與 `revoke`（本人）不同，
 * 這裡的授權不需要比對「這筆記錄是不是自己的」，`recordId` 可以指向公司內任何一位員工的打卡。
 *
 * **檢查順序、期間鎖定樁與撤銷更新的資料處理，與 `attendance-records.revoke.service.ts` 完全
 * 同構**（都是同一組 `revoked_*` 欄位、同一支 `markAttendanceRecordRevoked`，計畫 §4.3.1
 * 選項 A：兩者共用機制，差別只在「是誰把 `revoked_by` 填成誰」與稽核）——本檔不重複那段推論，
 * 只在「與 `revoke` 不同」的地方加註解。
 *
 * **必須寫 `audit_logs`**：具審核權限者對別人已生效的出勤事實做出「這筆不算數」的處置，性質與
 * 「審核結果變更」相鄰（計畫 §4.6）。欄位等級見 `modules/audit/main/domain/
 * audit-field-policy.ts` 的 `attendance_records` 節——**座標三欄是 `Presence` 級**，記進
 * `audit_logs`（不加密、任何具稽核查看權限的人都能查）等於讓「誰能看座標」這條可見範圍規則
 * （計畫 §4.2）被稽核旁路。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { recalculateAttendanceResultForWorkDay } from '../../results/attendance-results.service.ts'
import { isPeriodLocked } from '../domain/attendance-record-period-lock.ts'
import type { AttendanceRecordsContext } from '../domain/attendance-record-context.ts'
import type {
  AttendanceRecordDetail,
  AttendanceRecordRevokeOtherAuditSnapshot,
  RevokeOtherAttendanceRecordInput,
} from '../domain/attendance-record-model.ts'
import {
  attendanceRecordAlreadyRevoked,
  attendanceRecordClockOutMustBeRevokedFirst,
  attendanceRecordNotFound,
  attendanceRecordPeriodLocked,
} from '../attendance-records.errors.ts'
import {
  findAttendanceRecordDetail,
  findValidPunchOnDate,
  markAttendanceRecordRevoked,
} from '../attendance-records.repository.ts'

const revokeOtherAttendanceRecordInTransaction = async (
  tx: TransactionRunner,
  context: AttendanceRecordsContext,
  input: RevokeOtherAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> => {
  const now = context.clock.now()

  // 與 `revoke` 不同：不比對「是不是本人」——`revoke-other` 本來就是要撤銷別人的打卡。
  const record = await findAttendanceRecordDetail(tx, context.companyId, input.recordId)
  if (record === null) return fail([attendanceRecordNotFound()])
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

  // 稽核快照：`before` 恆為 `null`——這是「記錄這筆打卡被撤銷了什麼」的事件快照，不是逐欄比較
  // 撤銷前後差異（撤銷不會改動 `clockedAt`／`attendanceTypeCode` 等欄位，見 `domain/
  // attendance-record-model.ts` 的 `AttendanceRecordRevokeOtherAuditSnapshot` 檔頭）。
  const auditSnapshot: AttendanceRecordRevokeOtherAuditSnapshot = {
    clockedAt: record.clockedAt,
    attendanceTypeCode: record.attendanceTypeCode,
    latitude: record.latitude,
    longitude: record.longitude,
    address: record.address,
    revokeReason: input.reason,
  }
  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'attendance.records.revoke-other',
    subjectTable: 'attendance_records',
    subjectId: input.recordId,
    changes: buildAuditChanges('attendance_records', null, auditSnapshot),
    effectiveDate: record.workDate,
    now,
  })

  // ★ 同一筆交易內重算（計畫 §4.3.1：兩種撤銷之後都要重算，沒有差別；理由見
  // `attendance-records.revoke.service.ts` 檔頭「撤銷成功後……」那一段，這裡不重複）。
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

export const revokeOtherAttendanceRecord = (
  context: AttendanceRecordsContext,
  input: RevokeOtherAttendanceRecordInput,
): Promise<ServiceResult<AttendanceRecordDetail>> =>
  context.db.transaction((tx) => revokeOtherAttendanceRecordInTransaction(tx, context, input))
