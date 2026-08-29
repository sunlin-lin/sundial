/**
 * 資料存取：依 id 取單一職務的完整內容。形狀與 `job-titles/main/impl/job-titles-main.find.
 * repository.ts` 完全同構（含系統預設，繞過 `TenantDatabase` 預設 scope 的理由相同）。
 */
import { and, eq, isNull, or } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { jobPositions } from '../../../../db/schema/index.ts'
import type { JobPositionDetail } from '../domain/job-position-model.ts'

export const findJobPositionDetail = async (
  runner: QueryRunner,
  companyId: string,
  jobPositionId: string,
): Promise<JobPositionDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant
    .selectFrom(
      {
        id: jobPositions.id,
        companyId: jobPositions.companyId,
        code: jobPositions.code,
        name: jobPositions.name,
        description: jobPositions.description,
        status: jobPositions.status,
        createdAt: jobPositions.createdAt,
        updatedAt: jobPositions.updatedAt,
      },
      jobPositions,
    )
    .where(
      and(
        eq(jobPositions.id, jobPositionId),
        or(eq(jobPositions.companyId, companyId), isNull(jobPositions.companyId)),
        eq(jobPositions.deletedSeq, 0),
        isNull(jobPositions.deletedAt),
      ),
    )

  if (row === undefined) return null
  return {
    id: row.id,
    isSystem: row.companyId === null,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
