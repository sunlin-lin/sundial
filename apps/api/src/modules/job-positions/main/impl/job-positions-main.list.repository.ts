/**
 * 資料存取：職務清單的一頁 ＋ 總筆數。形狀與 `job-titles-main.list.repository.ts` 完全同構。
 */
import { and, asc, count, eq, isNull, like, or, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobPositions } from '../../../../db/schema/index.ts'
import { toKeywordPattern } from '../../../../shared/list-view.ts'
import type { JobPositionListPage, JobPositionListQuery } from '../domain/job-position-model.ts'

const buildConditions = (companyId: string, query: JobPositionListQuery): SQL | undefined => {
  const conditions = [
    or(eq(jobPositions.companyId, companyId), isNull(jobPositions.companyId)),
    eq(jobPositions.deletedSeq, 0),
    isNull(jobPositions.deletedAt),
  ]

  if (query.keyword !== null && query.keyword !== '') {
    const pattern = toKeywordPattern(query.keyword)
    conditions.push(or(like(jobPositions.code, pattern), like(jobPositions.name, pattern)))
  }

  return and(...conditions)
}

export const listJobPositionPage = async (
  runner: QueryRunner,
  companyId: string,
  query: JobPositionListQuery,
): Promise<JobPositionListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = buildConditions(companyId, query)

  const rows = await tenant
    .selectFrom(
      {
        id: jobPositions.id,
        companyId: jobPositions.companyId,
        code: jobPositions.code,
        name: jobPositions.name,
        description: jobPositions.description,
        status: jobPositions.status,
        createdAt: jobPositions.createdAt,
        updatedAt: jobPositions.updatedAt,
      },
      jobPositions,
    )
    .where(condition)
    .orderBy(asc(jobPositions.code), asc(jobPositions.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.selectFrom({ total: count() }, jobPositions).where(condition)
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
