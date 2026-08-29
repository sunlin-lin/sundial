/**
 * 資料存取：確認一個職稱存在，且是這家公司看得到的（自訂或系統預設）。
 *
 * **與 `department-histories` 的 `find-department.repository.ts` 不同**：那支直接用
 * `TenantDatabase.select`（`departments.company_id` 必填）；這裡職稱可能是系統預設
 * （`job_titles.company_id IS NULL`），因此改用 `selectFrom` 自組
 * `company_id = 本公司 OR company_id IS NULL` 條件，理由與 `job-titles-main.find.repository.ts`
 * 檔頭同構。
 */
import { and, eq, isNull, or } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobTitles } from '../../../../db/schema/index.ts'

export const findJobTitleForReference = async (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .selectFrom({ id: jobTitles.id }, jobTitles)
    .where(
      and(
        eq(jobTitles.id, jobTitleId),
        or(eq(jobTitles.companyId, companyId), isNull(jobTitles.companyId)),
        eq(jobTitles.deletedSeq, 0),
        isNull(jobTitles.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
