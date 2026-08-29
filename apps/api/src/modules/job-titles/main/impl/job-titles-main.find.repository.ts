/**
 * 資料存取：依 id 取單一職稱的完整內容。
 *
 * **刻意繞過 `TenantDatabase` 的預設 scope，改用 `selectFrom` 自組條件**：查詢範圍是「這家公司
 * 自訂的職稱，加上全平台共用的系統預設職稱」（`company_id = 本公司 OR company_id IS NULL`），
 * `TenantDatabase.select` 的 `eq(companyId, 本公司)` 天生找不到 `company_id IS NULL` 的列
 * ——這不是繞過封裝去圖方便，是 §4.2 封裝本身處理不了「同時含公司資料與全域共用資料」這種查詢
 * 形狀，`selectFrom` 正是 `db/client.ts` 開給這種場合的出口（見該檔 `selectFrom` 的檔頭說明）。
 *
 * 這支查詢**只用於 `get`（唯讀）**：一家公司應該看得到自己能選用的系統預設職稱長什麼樣子。
 * `update`／`delete` 改走 `TenantDatabase` 的標準 scope（見 `update-profile`／`mark-deleted`
 * 兩支切片），那條路徑天生摸不到系統預設列——公司不能修改或刪除系統預設，這是刻意的不對稱。
 */
import { and, eq, isNull, or } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobTitles } from '../../../../db/schema/index.ts'
import type { JobTitleDetail } from '../domain/job-title-model.ts'

export const findJobTitleDetail = async (
  runner: QueryRunner,
  companyId: string,
  jobTitleId: string,
): Promise<JobTitleDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant
    .selectFrom(
      {
        id: jobTitles.id,
        companyId: jobTitles.companyId,
        code: jobTitles.code,
        name: jobTitles.name,
        description: jobTitles.description,
        status: jobTitles.status,
        createdAt: jobTitles.createdAt,
        updatedAt: jobTitles.updatedAt,
      },
      jobTitles,
    )
    .where(
      and(
        eq(jobTitles.id, jobTitleId),
        or(eq(jobTitles.companyId, companyId), isNull(jobTitles.companyId)),
        // §4.3：軟刪除的職稱等同不存在。
        eq(jobTitles.deletedSeq, 0),
        isNull(jobTitles.deletedAt),
      ),
    )

  if (row === undefined) return null
  return {
    id: row.id,
    isSystem: row.companyId === null,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
