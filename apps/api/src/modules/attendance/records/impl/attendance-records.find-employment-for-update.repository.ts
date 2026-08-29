/**
 * 資料存取：在交易內鎖定並確認一筆任職目前仍是有效任職。**鎖的粒度＝任職**，且**必須是交易的
 * 第一句資料庫語句**（計畫 §4.5、`db/schema/attendance-records.ts` 檔頭）。
 *
 * 形狀比照 `employments/job-title-histories/impl/employments-job-title-histories.
 * find-employment-for-update.repository.ts`，差別只在**多比對 `status = 'ACTIVE'`**：打卡建立
 * 要求「操作者目前有效任職」，若在
 * `attendance-records.find-operator-employment.repository.ts` 的預先查詢（交易之外）與這裡的
 * 鎖定讀（交易第一句）之間，這筆任職剛好被辦了離職，鎖定讀重新核對一次條件會直接查無此列，
 * 回傳 `null`——這是正確的行為（不應該讓一個已離職的操作者用「舊快照裡還是在職」的殘影打卡），
 * 不是需要額外處理的邊界情況。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments, EmploymentStatus } from '../../../../db/schema/index.ts'

export const findEmploymentForUpdate = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string; readonly employeeId: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: employeeEmployments.id, employeeId: employeeEmployments.employeeId },
      employeeEmployments,
      eq(employeeEmployments.id, employmentId),
      eq(employeeEmployments.status, EmploymentStatus.Active),
      eq(employeeEmployments.deletedSeq, 0),
      isNull(employeeEmployments.deletedAt),
    )
    .limit(1)
    .for('update')

  const row = rows[0]
  return row === undefined ? null : { id: row.id, employeeId: row.employeeId }
}
