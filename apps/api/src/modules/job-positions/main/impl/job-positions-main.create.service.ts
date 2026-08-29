/**
 * 業務動作：新增職務（一律新增公司自訂職務）。無稽核，理由與 `job-titles-main.create.service.ts` 同構。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { JobPositionStatus } from '../../../../db/schema/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobPositionsMainContext } from '../domain/job-position-context.ts'
import type { CreateJobPositionInput, JobPositionDetail } from '../domain/job-position-model.ts'
import { jobPositionCodeDuplicated } from '../job-positions-main.errors.ts'
import { findJobPositionDetail, insertJobPosition } from '../job-positions-main.repository.ts'

export const createJobPositionInTransaction = async (
  tx: TransactionRunner,
  context: JobPositionsMainContext,
  input: CreateJobPositionInput,
): Promise<ServiceResult<JobPositionDetail>> => {
  const now = context.clock.now()
  const jobPositionId = crypto.randomUUID()

  const outcome = await insertJobPosition(tx, context.companyId, {
    id: jobPositionId,
    code: input.code,
    name: input.name,
    description: input.description,
    status: JobPositionStatus.Active,
    now,
  })
  if (outcome === 'duplicate-code') return fail([jobPositionCodeDuplicated()])

  const detail = await findJobPositionDetail(tx, context.companyId, jobPositionId)
  if (detail === null) {
    throw new Error(`職務 ${jobPositionId} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}
