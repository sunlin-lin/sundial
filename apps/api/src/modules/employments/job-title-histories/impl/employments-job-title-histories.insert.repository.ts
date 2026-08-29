/** 資料存取：新增職稱歷史。理由與 `department-histories` 的同名切片同構。 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeJobTitleHistories } from '../../../../db/schema/index.ts'
import {
  isDuplicateJobTitleHistoryEffectiveFrom,
  type JobTitleHistoryInsertOutcome,
} from '../domain/job-title-history-duplicate.ts'

export type NewJobTitleHistory = {
  readonly id: string
  readonly employmentId: string
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly now: string
}

export const insertJobTitleHistory = async (
  runner: QueryRunner,
  companyId: string,
  history: NewJobTitleHistory,
): Promise<JobTitleHistoryInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(employeeJobTitleHistories, (scopedCompanyId) => ({
      id: history.id,
      companyId: scopedCompanyId,
      employmentId: history.employmentId,
      jobTitleId: history.jobTitleId,
      effectiveFrom: history.effectiveFrom,
      effectiveTo: history.effectiveTo,
      createdAt: history.now,
      updatedAt: history.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateJobTitleHistoryEffectiveFrom(error)) return 'duplicate-effective-from'
    throw error
  }
}
