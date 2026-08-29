/**
 * 資料存取：一筆任職**目前全部**的部門歸屬期間。唯一呼叫者是 `create` 的重疊檢查，
 * 理由與 `employments/main/impl/employments-main.list-periods.repository.ts` 同構。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeDepartmentHistories } from '../../../../db/schema/index.ts'
import type { EffectivePeriod } from '../../../../shared/effective-period.ts'

export const listDepartmentHistoryPeriods = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<readonly EffectivePeriod[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  return await tenant.select(
    { effectiveFrom: employeeDepartmentHistories.effectiveFrom, effectiveTo: employeeDepartmentHistories.effectiveTo },
    employeeDepartmentHistories,
    eq(employeeDepartmentHistories.employmentId, employmentId),
  )
}
