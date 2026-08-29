/**
 * 資料存取：職稱清單的一頁 ＋ 總筆數。
 *
 * 範圍是「這家公司自訂的職稱 ＋ 系統預設職稱」，理由與 `job-titles-main.find.repository.ts` 檔頭
 * 相同：`selectFrom` ＋ 自組 `company_id = 本公司 OR company_id IS NULL` 條件，繞過
 * `TenantDatabase` 對 `company_id IS NULL` 天生找不到的預設 scope。
 */
import { and, asc, count, eq, isNull, like, or, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobTitles } from '../../../../db/schema/index.ts'
import { toKeywordPattern } from '../../../../shared/list-view.ts'
import type { JobTitleListPage, JobTitleListQuery } from '../domain/job-title-model.ts'

const buildConditions = (companyId: string, query: JobTitleListQuery): SQL | undefined => {
  const conditions = [
    or(eq(jobTitles.companyId, companyId), isNull(jobTitles.companyId)),
    eq(jobTitles.deletedSeq, 0),
    isNull(jobTitles.deletedAt),
  ]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(jobTitles.code, pattern), like(jobTitles.name, pattern)))
  }

  return and(...conditions)
}

export const listJobTitlePage = async (
  runner: QueryRunner,
  companyId: string,
  query: JobTitleListQuery,
): Promise<JobTitleListPage> => {
  // 這裡仍然透過 `TenantDatabase` 取得底層 runner（不是它的 scope 方法）：`selectFrom`
  // 本身就是它開給這種查詢形狀的出口，理由見檔頭。
  const tenant = new TenantDatabase(runner, companyId)
  const condition = buildConditions(companyId, query)

  const rows = await tenant
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
    .where(condition)
    // 依代碼排序，第二排序鍵固定 id（理由與其他列表端點相同：分頁間順序需要穩定）。
    .orderBy(asc(jobTitles.code), asc(jobTitles.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.selectFrom({ total: count() }, jobTitles).where(condition)
  const [totalRow] = totals

  return {
    items: rows.map((row) => ({
      id: row.id,
      isSystem: row.companyId === null,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    totalCount: totalRow?.total ?? 0,
  }
}
