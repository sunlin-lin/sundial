/** 資料存取：一位員工目前全部的扣繳有效期間。唯一呼叫者是 `create` 的重疊檢查。 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeWithholdingSettings } from '../../../../db/schema/index.ts'
import type { EffectivePeriod } from '../../../../shared/effective-period.ts'

export const listWithholdingPeriods = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<readonly EffectivePeriod[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  return await tenant.select(
    { effectiveFrom: employeeWithholdingSettings.effectiveFrom, effectiveTo: employeeWithholdingSettings.effectiveTo },
    employeeWithholdingSettings,
    eq(employeeWithholdingSettings.employeeId, employeeId),
  )
}
