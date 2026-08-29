/** 資料存取：勞退設定清單的一頁 ＋ 總筆數。理由與 `withholding-main.list.repository.ts` 同構。 */
import { asc, count, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeLaborPensionSettings } from '../../../../db/schema/index.ts'
import type { LaborPensionSettingListPage, LaborPensionSettingListQuery } from '../domain/labor-pension-model.ts'

export const listLaborPensionSettingPage = async (
  runner: QueryRunner,
  companyId: string,
  query: LaborPensionSettingListQuery,
): Promise<LaborPensionSettingListPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const condition = eq(employeeLaborPensionSettings.employeeId, query.employeeId)

  const rows = await tenant
    .select(
      {
        id: employeeLaborPensionSettings.id,
        employeeId: employeeLaborPensionSettings.employeeId,
        voluntaryContributionRate: employeeLaborPensionSettings.voluntaryContributionRate,
        effectiveFrom: employeeLaborPensionSettings.effectiveFrom,
        effectiveTo: employeeLaborPensionSettings.effectiveTo,
        createdBy: employeeLaborPensionSettings.createdBy,
        createdAt: employeeLaborPensionSettings.createdAt,
        updatedAt: employeeLaborPensionSettings.updatedAt,
      },
      employeeLaborPensionSettings,
      condition,
    )
    .orderBy(asc(employeeLaborPensionSettings.effectiveFrom), asc(employeeLaborPensionSettings.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totalRows = await tenant.select({ total: count() }, employeeLaborPensionSettings, condition)
  const [totalRow] = totalRows

  return { items: rows, totalCount: totalRow?.total ?? 0 }
}
