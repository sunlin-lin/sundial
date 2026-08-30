/**
 * 資料存取：撤回一筆補打卡申請（條件式 UPDATE）。
 *
 * **不需要額外上鎖**：`WHERE id = ? AND status_code = Pending` 的條件式 UPDATE 本身就是併發安全
 * 的——影響列數為 0 就代表讀取與寫入之間這筆申請的狀態已經被別的動作改變過了（比照 `attendance/
 * records` 的 `markAttendanceRecordRevoked` 同一種寫法）。
 *
 * `pendingSeq` 改成撤回當下的 epoch 毫秒，讓同一個工作日、同一種類型的待審核名額重新空出來
 * （`db/schema/attendance-correction-requests.ts` 檔頭「重複申請的唯一鍵」段落）。
 */
import { and, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceCorrectionRequests, AttendanceCorrectionRequestStatusCode } from '../../../../db/schema/index.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'

export type WithdrawAttendanceCorrectionRequestUpdate = {
  /** 撤回時寫入 `pending_seq` 的唯一非零值，見檔頭。 */
  readonly pendingSeq: number
  readonly now: string
}

/** @returns 影響列數。**0 代表在讀取與寫入之間這筆申請已經不是待審核狀態了**（例如已被同時發出的
 * 另一次撤回請求搶先處理）。 */
export const markAttendanceCorrectionRequestWithdrawn = async (
  runner: QueryRunner,
  companyId: string,
  requestId: string,
  update: WithdrawAttendanceCorrectionRequestUpdate,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    attendanceCorrectionRequests,
    {
      statusCode: AttendanceCorrectionRequestStatusCode.Withdrawn,
      pendingSeq: update.pendingSeq,
      updatedAt: update.now,
    },
    and(
      eq(attendanceCorrectionRequests.id, requestId),
      eq(attendanceCorrectionRequests.statusCode, AttendanceCorrectionRequestStatusCode.Pending),
    ),
  )

  return readAffectedRows(result)
}
