/**
 * 資料存取：任職清單的一頁 ＋ 總筆數。理由與 `employees-main.list.repository.ts` 同構，不重述。
 */
import { asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments } from '../../../../db/schema/index.ts'
import type { EmploymentListPage, EmploymentListQuery } from '../domain/employment-model.ts'

const sortColumn = (field: string) => {
  switch (field) {
    case 'hireDate':
      return employeeEmployments.hireDate
    case 'updatedAt':
      return employeeEmployments.updatedAt
    default:
      return employeeEmployments.hireDate
  }
}

const buildConditions = (query: EmploymentListQuery): readonly (SQL | undefined)[] => {
  const conditions: (SQL | undefined)[] = [eq(employeeEmployments.deletedSeq, 0), isNull(employeeEmployments.deletedAt)]
  if (query.employeeId !== null) conditions.push(eq(employeeEmployments.employeeId, query.employeeId))
  return conditions
}

export const listEmploymentPage = async (
  runner: QueryRunner,
  companyId: string,
  query: EmploymentListQuery,
): Promise<EmploymentListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const conditions = buildConditions(query)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await tenant
    .select(
      {
        id: employeeEmployments.id,
        employeeId: employeeEmployments.employeeId,
        employmentTypeCode: employeeEmployments.employmentTypeCode,
        employmentNatureCode: employeeEmployments.employmentNatureCode,
        hireDate: employeeEmployments.hireDate,
        leaveDate: employeeEmployments.leaveDate,
        lastWorkingDate: employeeEmployments.lastWorkingDate,
        leaveReasonCode: employeeEmployments.leaveReasonCode,
        status: employeeEmployments.status,
        createdAt: employeeEmployments.createdAt,
        updatedAt: employeeEmployments.updatedAt,
      },
      employeeEmployments,
      ...conditions,
    )
    // 第二排序鍵固定為 id：理由與 `employees-main.list.repository.ts` 相同（同日期的列在分頁間
    // 順序不保證）。
    .orderBy(direction(sortColumn(query.sort.field)), asc(employeeEmployments.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeEmployments, ...conditions)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
