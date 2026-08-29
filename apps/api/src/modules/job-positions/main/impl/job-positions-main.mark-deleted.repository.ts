/** 資料存取：軟刪除職務。理由與 `job-titles-main.mark-deleted.repository.ts` 同構。 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { jobPositions } from '../../../../db/schema/index.ts'

export type JobPositionDeletion = {
  readonly now: string
  readonly deletedSeq: number
}

export const markJobPositionDeleted = async (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
  deletion: JobPositionDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    jobPositions,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(jobPositions.id, jobPositionId),
    eq(jobPositions.deletedSeq, 0),
    isNull(jobPositions.deletedAt),
  )

  return readAffectedRows(result)
}
