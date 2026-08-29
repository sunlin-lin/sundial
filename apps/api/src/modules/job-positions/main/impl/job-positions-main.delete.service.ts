/**
 * 業務動作：刪除職務（軟刪除）。**本輪不檢查是否仍被員工引用**，理由與
 * `job-titles-main.delete.service.ts` 同構——`employee_job_position_histories.job_position_id`
 * 同樣是單欄外鍵，刪除不會撞外鍵。系統預設職務回 `NotFound`。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionsMainContext } from '../domain/job-position-context.ts'
import type { DeletedJobPosition, JobPositionTargetInput } from '../domain/job-position-model.ts'
import { jobPositionNotFound, jobPositionStateChanged } from '../job-positions-main.errors.ts'
import { findJobPositionDetail, markJobPositionDeleted } from '../job-positions-main.repository.ts'

export const deleteJobPositionInTransaction = async (
  tx: TransactionRunner,
  context: JobPositionsMainContext,
  input: JobPositionTargetInput,
): Promise<ServiceResult<DeletedJobPosition>> => {
  const now = context.clock.now()
  const deletedSeq = context.clock.epochMs()

  const current = await findJobPositionDetail(tx, context.companyId, input.id)
  if (current === null || current.isSystem) return fail([jobPositionNotFound()])

  const affectedRows = await markJobPositionDeleted(tx, context.companyId, input.id, { now, deletedSeq })
  if (affectedRows === 0) return fail([jobPositionStateChanged()])

  return succeed({ id: input.id })
}
