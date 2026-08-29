/** 資料存取：職稱歷史清單的一頁 ＋ 總筆數。理由與 `department-histories` 的同名切片同構。 */
import { asc, count, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobTitleHistories } from '../../../../db/schema/index.ts'
import type { JobTitleHistoryListPage, JobTitleHistoryListQuery } from '../domain/job-title-history-model.ts'

export const listJobTitleHistoryPage = async (
  runner: QueryRunner,
  companyId: string,
  query: JobTitleHistoryListQuery,
): Promise<JobTitleHistoryListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = eq(employeeJobTitleHistories.employmentId, query.employmentId)

  const rows = await tenant
    .select(
      {
        id: employeeJobTitleHistories.id,
        employmentId: employeeJobTitleHistories.employmentId,
        jobTitleId: employeeJobTitleHistories.jobTitleId,
        effectiveFrom: employeeJobTitleHistories.effectiveFrom,
        effectiveTo: employeeJobTitleHistories.effectiveTo,
        createdAt: employeeJobTitleHistories.createdAt,
        updatedAt: employeeJobTitleHistories.updatedAt,
      },
      employeeJobTitleHistories,
      condition,
    )
    .orderBy(asc(employeeJobTitleHistories.effectiveFrom), asc(employeeJobTitleHistories.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeJobTitleHistories, condition)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
