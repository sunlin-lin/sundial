/** 資料存取：職務歷史清單的一頁 ＋ 總筆數。理由與其餘歷史表的同名切片同構。 */
import { asc, count, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobPositionHistories } from '../../../../db/schema/index.ts'
import type { JobPositionHistoryListPage, JobPositionHistoryListQuery } from '../domain/job-position-history-model.ts'

export const listJobPositionHistoryPage = async (
  runner: QueryRunner,
  companyId: string,
  query: JobPositionHistoryListQuery,
): Promise<JobPositionHistoryListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = eq(employeeJobPositionHistories.employmentId, query.employmentId)

  const rows = await tenant
    .select(
      {
        id: employeeJobPositionHistories.id,
        employmentId: employeeJobPositionHistories.employmentId,
        jobPositionId: employeeJobPositionHistories.jobPositionId,
        effectiveFrom: employeeJobPositionHistories.effectiveFrom,
        effectiveTo: employeeJobPositionHistories.effectiveTo,
        createdAt: employeeJobPositionHistories.createdAt,
        updatedAt: employeeJobPositionHistories.updatedAt,
      },
      employeeJobPositionHistories,
      condition,
    )
    .orderBy(asc(employeeJobPositionHistories.effectiveFrom), asc(employeeJobPositionHistories.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeJobPositionHistories, condition)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
