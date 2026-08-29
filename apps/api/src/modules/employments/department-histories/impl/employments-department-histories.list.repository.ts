/** 資料存取：部門歷史清單的一頁 ＋ 總筆數。理由與 `employments-main.list.repository.ts` 同構。 */
import { asc, count, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeDepartmentHistories } from '../../../../db/schema/index.ts'
import type { DepartmentHistoryListPage, DepartmentHistoryListQuery } from '../domain/department-history-model.ts'

export const listDepartmentHistoryPage = async (
  runner: QueryRunner,
  companyId: string,
  query: DepartmentHistoryListQuery,
): Promise<DepartmentHistoryListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = eq(employeeDepartmentHistories.employmentId, query.employmentId)

  const rows = await tenant
    .select(
      {
        id: employeeDepartmentHistories.id,
        employmentId: employeeDepartmentHistories.employmentId,
        departmentId: employeeDepartmentHistories.departmentId,
        effectiveFrom: employeeDepartmentHistories.effectiveFrom,
        effectiveTo: employeeDepartmentHistories.effectiveTo,
        createdAt: employeeDepartmentHistories.createdAt,
        updatedAt: employeeDepartmentHistories.updatedAt,
      },
      employeeDepartmentHistories,
      condition,
    )
    // 依生效日新到舊：使用者最常想先看到「目前」與「最近」的部門歸屬。第二排序鍵固定 id
    // （理由與其他列表端點相同：同一天生效的列在分頁間順序不保證）。
    .orderBy(asc(employeeDepartmentHistories.effectiveFrom), asc(employeeDepartmentHistories.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeDepartmentHistories, condition)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
