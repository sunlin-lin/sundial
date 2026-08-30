/**
 * 資料存取：新增一筆補打卡申請。唯一鍵違反轉成 `AttendanceCorrectionRequestInsertOutcome`——
 * §4.3 要求的「先寫入、攔截驅動錯誤」才是真正的併發保證，`submit.service.ts` 的預檢查
 * （`findPendingAttendanceCorrectionRequest`）只是為了給一個更明確的業務錯誤，不是唯一防線。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceCorrectionRequests, AttendanceCorrectionRequestStatusCode } from '../../../../db/schema/index.ts'
import {
  isDuplicateAttendanceCorrectionRequest,
  type AttendanceCorrectionRequestInsertOutcome,
} from '../domain/attendance-correction-request-duplicate.ts'
import type { AttendanceTypeCodeValue } from '../domain/attendance-correction-request-model.ts'

export type NewAttendanceCorrectionRequest = {
  readonly id: string
  readonly employeeId: string
  readonly employmentId: string
  readonly workDate: string
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly requestedClockedAt: string
  readonly reason: string
  readonly now: string
}

export const insertAttendanceCorrectionRequest = async (
  runner: QueryRunner,
  companyId: string,
  request: NewAttendanceCorrectionRequest,
): Promise<AttendanceCorrectionRequestInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(attendanceCorrectionRequests, (scopedCompanyId) => ({
      id: request.id,
      companyId: scopedCompanyId,
      employeeId: request.employeeId,
      employmentId: request.employmentId,
      // 排班（第 3 層）尚未動工，這一欄本階段恆為 null，見 `db/schema/
      // attendance-correction-requests.ts` 檔頭第 3 點。
      employeeScheduleId: null,
      workDate: request.workDate,
      attendanceTypeCode: request.attendanceTypeCode,
      requestedClockedAt: request.requestedClockedAt,
      reason: request.reason,
      statusCode: AttendanceCorrectionRequestStatusCode.Pending,
      pendingSeq: 0,
      createdAt: request.now,
      updatedAt: request.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateAttendanceCorrectionRequest(error)) return 'duplicate'
    throw error
  }
}
