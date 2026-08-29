/** 資料存取：新增職務（一律新增公司自訂，`is_system=false`）。理由與 `job-titles-main.insert.repository.ts` 同構。 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobPositions, type JobPositionStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateJobPositionCode, type JobPositionInsertOutcome } from '../domain/job-position-duplicate.ts'

export type NewJobPosition = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobPositionStatusValue
  readonly now: string
}

export const insertJobPosition = async (
  runner: QueryRunner,
  companyId: string,
  jobPosition: NewJobPosition,
): Promise<JobPositionInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(jobPositions, (scopedCompanyId) => ({
      id: jobPosition.id,
      companyId: scopedCompanyId,
      code: jobPosition.code,
      name: jobPosition.name,
      description: jobPosition.description,
      isSystem: false,
      status: jobPosition.status,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: jobPosition.now,
      updatedAt: jobPosition.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateJobPositionCode(error)) return 'duplicate-code'
    throw error
  }
}
