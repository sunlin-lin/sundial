/** 資料存取：一位員工的眷屬清單的一頁 ＋ 總筆數。理由與 `employments-main.list.repository.ts` 同構。 */
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeDependents } from '../../../../db/schema/index.ts'
import type { DependentListPage, DependentListQuery } from '../domain/dependent-model.ts'
import { toMaskedDetail } from '../domain/dependent-secrets.ts'

export const listDependentPage = async (
  runner: QueryRunner,
  companyId: string,
  query: DependentListQuery,
): Promise<DependentListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  // §4.3：軟刪除的眷屬等同不存在。
  const condition = and(
    eq(employeeDependents.employeeId, query.employeeId),
    eq(employeeDependents.deletedSeq, 0),
    isNull(employeeDependents.deletedAt),
  )

  const rows = await tenant
    .select(
      {
        id: employeeDependents.id,
        employeeId: employeeDependents.employeeId,
        name: employeeDependents.name,
        identityNumber: employeeDependents.identityNumber,
        birthday: employeeDependents.birthday,
        relationshipCode: employeeDependents.relationshipCode,
        isStudent: employeeDependents.isStudent,
        isDisabled: employeeDependents.isDisabled,
        isUnableToWork: employeeDependents.isUnableToWork,
        isCohabiting: employeeDependents.isCohabiting,
        effectiveDate: employeeDependents.effectiveDate,
        endDate: employeeDependents.endDate,
        status: employeeDependents.status,
        createdAt: employeeDependents.createdAt,
        updatedAt: employeeDependents.updatedAt,
      },
      employeeDependents,
      condition,
    )
    .orderBy(asc(employeeDependents.effectiveDate), asc(employeeDependents.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeDependents, condition)
  const [totalRow] = totalRows

  return { items: rows.map((row) => toMaskedDetail(row)), totalCount: totalRow?.total ?? 0 }
}
