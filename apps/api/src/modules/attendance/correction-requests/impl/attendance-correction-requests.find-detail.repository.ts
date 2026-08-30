/** 資料存取：依 id 查單筆補打卡申請明細。**只以公司範圍限縮，不比對是不是呼叫者本人**——「是不是
 * 本人」是 service 層的細粒度判斷（比照 `attendance/records` 的 `findAttendanceRecordDetail`
 * 檔頭同一種分工）。 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceCorrectionRequests } from '../../../../db/schema/index.ts'
import type {
  AttendanceCorrectionRequestDetail,
  AttendanceTypeCodeValue,
} from '../domain/attendance-correction-request-model.ts'

export const findAttendanceCorrectionRequestDetail = async (
  runner: QueryRunner,
  companyId: string,
  requestId: string,
): Promise<AttendanceCorrectionRequestDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    {
      id: attendanceCorrectionRequests.id,
      employeeId: attendanceCorrectionRequests.employeeId,
      employmentId: attendanceCorrectionRequests.employmentId,
      workDate: attendanceCorrectionRequests.workDate,
      attendanceTypeCode: attendanceCorrectionRequests.attendanceTypeCode,
      requestedClockedAt: attendanceCorrectionRequests.requestedClockedAt,
      reason: attendanceCorrectionRequests.reason,
      statusCode: attendanceCorrectionRequests.statusCode,
      createdAt: attendanceCorrectionRequests.createdAt,
      updatedAt: attendanceCorrectionRequests.updatedAt,
    },
    attendanceCorrectionRequests,
    eq(attendanceCorrectionRequests.id, requestId),
  )

  const row = rows[0]
  return row === undefined ? null : row
}

/** 依工作日＋類型查目前是否已有一筆待審核申請（`pending_seq = 0`）——`submit` 的預檢查，理由見
 * `db/schema/attendance-correction-requests.ts` 檔頭：唯一鍵才是真正的保證，這裡只是為了在攔截
 * 驅動錯誤之前先給一個更明確的業務錯誤路徑（§4.3 允許「先查再攔截」並存，只要攔截仍然存在）。 */
export const findPendingAttendanceCorrectionRequest = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  workDate: string,
  attendanceTypeCode: AttendanceTypeCodeValue,
): Promise<{ readonly id: string } | null> => {
  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant
    .select(
      { id: attendanceCorrectionRequests.id },
      attendanceCorrectionRequests,
      eq(attendanceCorrectionRequests.employeeId, employeeId),
      eq(attendanceCorrectionRequests.workDate, workDate),
      eq(attendanceCorrectionRequests.attendanceTypeCode, attendanceTypeCode),
      eq(attendanceCorrectionRequests.pendingSeq, 0),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
