/**
 * 資料存取：批次新增職務歷史（§4.5：一次寫入多筆，不在迴圈裡逐筆 insert）。
 *
 * 用 `TenantDatabase.insertMany`（`db/client.ts`）：公司 id 只有一個來源，理由與其餘批次寫入
 * （`company-users/roles` 的 `insertAssignments`）相同。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobPositionHistories } from '../../../../db/schema/index.ts'
import {
  isDuplicateJobPositionHistoryEffectiveFrom,
  type JobPositionHistoryInsertOutcome,
} from '../domain/job-position-history-duplicate.ts'

export type NewJobPositionHistory = {
  readonly id: string
  readonly employmentId: string
  readonly jobPositionId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly now: string
}

export const insertJobPositionHistories = async (
  runner: QueryRunner,
  companyId: string,
  histories: readonly NewJobPositionHistory[],
): Promise<JobPositionHistoryInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insertMany(employeeJobPositionHistories, (scopedCompanyId) =>
      histories.map((history) => ({
        id: history.id,
        companyId: scopedCompanyId,
        employmentId: history.employmentId,
        jobPositionId: history.jobPositionId,
        effectiveFrom: history.effectiveFrom,
        effectiveTo: history.effectiveTo,
        createdAt: history.now,
        updatedAt: history.now,
      })),
    )
    return 'inserted'
  } catch (error) {
    if (isDuplicateJobPositionHistoryEffectiveFrom(error)) return 'duplicate-effective-from'
    throw error
  }
}
