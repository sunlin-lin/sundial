/**
 * 資料存取：辦理離職——寫入離職三欄並把狀態改成 `LEFT`。
 *
 * **條件式 UPDATE ＋ 檢查影響列數**（§4.4）：`WHERE` 帶上「預期的目前狀態」是
 * `leave_date IS NULL`（還沒辦過離職）。兩個人同時對同一筆任職按離職，第二筆會影響 0 列
 * ——不是因為资料被改壞，是離職本來就不是可以重複執行的動作。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { EmploymentStatus, employeeEmployments } from '../../../../db/schema/index.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'

export type LeaveUpdate = {
  readonly leaveDate: string
  readonly lastWorkingDate: string
  readonly leaveReasonCode: number
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

/** @returns 影響列數。**0 代表在讀取與寫入之間已經有人辦過離職（或刪除）了這筆任職**（§4.4）。 */
export const markEmploymentLeft = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  update: LeaveUpdate,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    employeeEmployments,
    {
      leaveDate: update.leaveDate,
      lastWorkingDate: update.lastWorkingDate,
      leaveReasonCode: update.leaveReasonCode,
      status: EmploymentStatus.Left,
      updatedAt: update.now,
    },
    eq(employeeEmployments.id, employmentId),
    // 預期目前狀態：尚未離職、未刪除。
    isNull(employeeEmployments.leaveDate),
    eq(employeeEmployments.deletedSeq, 0),
    isNull(employeeEmployments.deletedAt),
  )

  return readAffectedRows(result)
}
