/**
 * 資料存取：確認一筆任職存在。**不在這裡上鎖**——本模組的序列化鎖點是 `job_positions`
 * （見 `find-job-positions-for-update.repository.ts` 檔頭「為什麼鎖 `job_positions`」），
 * 任職本身只需要一般查詢確認存在與公司範圍，不需要 `FOR UPDATE`。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments } from '../../../../db/schema/index.ts'

export const findEmploymentForReference = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: employeeEmployments.id },
      employeeEmployments,
      eq(employeeEmployments.id, employmentId),
      eq(employeeEmployments.deletedSeq, 0),
      isNull(employeeEmployments.deletedAt),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
