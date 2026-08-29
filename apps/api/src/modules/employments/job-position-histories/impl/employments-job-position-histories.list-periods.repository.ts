/**
 * 資料存取：一筆任職、一組職務，**目前全部**的有效期間，依 `job_position_id` 分組。
 *
 * 一次查完這批職務全部的既有期間（§4.5：不逐一職務各查一次），呼叫端在記憶體裡用 `Map`
 * 依 `job_position_id` 對應回去，逐筆核對重疊——這正是 `dev-standards-backend.md` §4.5
 * 「先蒐集鍵、一次查完、記憶體裡用 Map 對應」的標準寫法。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobPositionHistories } from '../../../../db/schema/index.ts'
import type { EffectivePeriod } from '../../../../shared/effective-period.ts'

export const listJobPositionHistoryPeriodsByJobPosition = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
  jobPositionIds: readonly string[],
): Promise<ReadonlyMap<string, readonly EffectivePeriod[]>> => {
  if (jobPositionIds.length === 0) return new Map()

  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant.select(
    {
      jobPositionId: employeeJobPositionHistories.jobPositionId,
      effectiveFrom: employeeJobPositionHistories.effectiveFrom,
      effectiveTo: employeeJobPositionHistories.effectiveTo,
    },
    employeeJobPositionHistories,
    and(
      eq(employeeJobPositionHistories.employmentId, employmentId),
      inArray(employeeJobPositionHistories.jobPositionId, [...jobPositionIds]),
    ),
  )

  const periodsByJobPosition = new Map<string, EffectivePeriod[]>()
  for (const row of rows) {
    const existing = periodsByJobPosition.get(row.jobPositionId) ?? []
    existing.push({ effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo })
    periodsByJobPosition.set(row.jobPositionId, existing)
  }
  return periodsByJobPosition
}
