/** 資料存取：一筆任職**目前全部**的職稱歷史期間。理由與 `department-histories` 的同名切片同構。 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobTitleHistories } from '../../../../db/schema/index.ts'
import type { EffectivePeriod } from '../../../../shared/effective-period.ts'

export const listJobTitleHistoryPeriods = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<readonly EffectivePeriod[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  return await tenant.select(
    { effectiveFrom: employeeJobTitleHistories.effectiveFrom, effectiveTo: employeeJobTitleHistories.effectiveTo },
    employeeJobTitleHistories,
    eq(employeeJobTitleHistories.employmentId, employmentId),
  )
}
