/** 資料存取：扣繳設定清單的一頁 ＋ 總筆數。理由與 `employments-main.list.repository.ts` 同構。 */
import { asc, count, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeWithholdingSettings } from '../../../../db/schema/index.ts'
import type { WithholdingSettingListPage, WithholdingSettingListQuery } from '../domain/withholding-model.ts'

export const listWithholdingSettingPage = async (
  runner: QueryRunner,
  companyId: string,
  query: WithholdingSettingListQuery,
): Promise<WithholdingSettingListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = eq(employeeWithholdingSettings.employeeId, query.employeeId)

  const rows = await tenant
    .select(
      {
        id: employeeWithholdingSettings.id,
        employeeId: employeeWithholdingSettings.employeeId,
        withholdingMethodCode: employeeWithholdingSettings.withholdingMethodCode,
        effectiveFrom: employeeWithholdingSettings.effectiveFrom,
        effectiveTo: employeeWithholdingSettings.effectiveTo,
        createdAt: employeeWithholdingSettings.createdAt,
        updatedAt: employeeWithholdingSettings.updatedAt,
      },
      employeeWithholdingSettings,
      condition,
    )
    .orderBy(asc(employeeWithholdingSettings.effectiveFrom), asc(employeeWithholdingSettings.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeWithholdingSettings, condition)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
