/**
 * 資料存取：一位員工**目前全部**未刪除任職的到職～離職期間。
 *
 * 唯一呼叫者是 `create` 的重疊檢查（`shared/effective-period.ts` 的 `overlapsAnyPeriod`）。
 * **必須在鎖住 `employees` 那一列之後、同一交易內查詢**——否則會出現「查的時候沒重疊，鎖到手之後
 * 別人剛好插進一筆」的視窗（見 `impl/employments-main.create.service.ts`）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments } from '../../../../db/schema/index.ts'
import type { EffectivePeriod } from '../../../../shared/effective-period.ts'

export const listEmployeeEmploymentPeriods = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<readonly EffectivePeriod[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant.select(
    { effectiveFrom: employeeEmployments.hireDate, effectiveTo: employeeEmployments.leaveDate },
    employeeEmployments,
    eq(employeeEmployments.employeeId, employeeId),
    eq(employeeEmployments.deletedSeq, 0),
    isNull(employeeEmployments.deletedAt),
  )

  return rows
}
