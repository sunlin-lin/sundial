/**
 * 業務動作：修改職務（含啟用／停用）。系統預設職務回 `NotFound`，理由與
 * `job-titles-main.update.service.ts` 同構。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionsMainContext } from '../domain/job-position-context.ts'
import type { JobPositionDetail, UpdateJobPositionInput } from '../domain/job-position-model.ts'
import { jobPositionCodeDuplicated, jobPositionNotFound } from '../job-positions-main.errors.ts'
import { findJobPositionDetail, updateJobPositionProfile } from '../job-positions-main.repository.ts'

export const updateJobPositionInTransaction = async (
  tx: TransactionRunner,
  context: JobPositionsMainContext,
  input: UpdateJobPositionInput,
): Promise<ServiceResult<JobPositionDetail>> => {
  const now = context.clock.now()

  const current = await findJobPositionDetail(tx, context.companyId, input.id)
  if (current === null || current.isSystem) return fail([jobPositionNotFound()])

  const outcome = await updateJobPositionProfile(tx, context.companyId, input.id, {
    code: input.code,
    name: input.name,
    description: input.description,
    status: input.status,
    now,
  })
  if (outcome === 'duplicate-code') return fail([jobPositionCodeDuplicated()])

  const updated = await findJobPositionDetail(tx, context.companyId, input.id)
  if (updated === null) {
    throw new Error(`職務 ${input.id} 更新後於同一交易內讀不回來`)
  }
  return succeed(updated)
}
