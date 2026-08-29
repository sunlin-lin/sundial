/** 資料存取：更新職務主檔基本欄位。理由與 `job-titles-main.update-profile.repository.ts` 同構。 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobPositions, type JobPositionStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateJobPositionCode } from '../domain/job-position-duplicate.ts'

export type JobPositionProfileUpdate = {
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobPositionStatusValue
  readonly now: string
}

export type JobPositionProfileUpdateOutcome = 'written' | 'duplicate-code'

export const updateJobPositionProfile = async (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
  update: JobPositionProfileUpdate,
): Promise<JobPositionProfileUpdateOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.update(
      jobPositions,
      {
        code: update.code,
        name: update.name,
        description: update.description,
        status: update.status,
        updatedAt: update.now,
      },
      eq(jobPositions.id, jobPositionId),
      eq(jobPositions.deletedSeq, 0),
      isNull(jobPositions.deletedAt),
    )

    return 'written'
  } catch (error) {
    if (isDuplicateJobPositionCode(error)) return 'duplicate-code'
    throw error
  }
}
