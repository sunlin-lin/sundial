/**
 * 資料存取：撤銷一筆打卡（條件式 UPDATE，計畫 §4.5）。
 *
 * `revoke`（本人）與 `revoke-other`（他人）共用同一支函式與同一組 `revoked_*` 欄位
 * （計畫 §4.3.1 選項 A）——差別只在呼叫端傳入的 `revokedBy` 是誰，事後比較 `revoked_by` 是否
 * 等於這筆記錄 `employee_id` 目前綁定的帳號即可分辨是哪一種撤銷。
 *
 * **不需要額外上鎖**：`WHERE revoked_at IS NULL AND id = ?` 的條件式 UPDATE 本身就是併發安全的
 * ——影響列數為 0 就代表讀取與寫入之間已經有人撤銷過了（§4.4）。
 */
import { and, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords } from '../../../../db/schema/index.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'

export type RevokeAttendanceRecordUpdate = {
  readonly revokedBy: string
  readonly revokeReason: string
  /** 撤銷流水號，與 `employees.deleted_seq`／`company_user_roles.revoked_seq` 同一種作法：
   * 用撤銷當下的 epoch 毫秒，同一筆記錄只會被撤銷一次，因此不可能與自己碰撞。 */
  readonly revokedSeq: number
  readonly now: string
}

/** @returns 影響列數。**0 代表在讀取與寫入之間已經有人撤銷過這筆記錄了**（§4.4）。 */
export const markAttendanceRecordRevoked = async (
  runner: QueryRunner,
  companyId: string,
  recordId: string,
  update: RevokeAttendanceRecordUpdate,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    attendanceRecords,
    {
      revokedAt: update.now,
      revokedBy: update.revokedBy,
      revokeReason: update.revokeReason,
      revokedSeq: update.revokedSeq,
      updatedAt: update.now,
    },
    and(eq(attendanceRecords.id, recordId), isNull(attendanceRecords.revokedAt), eq(attendanceRecords.revokedSeq, 0)),
  )

  return readAffectedRows(result)
}
