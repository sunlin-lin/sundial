/**
 * 業務動作：新增職稱（一律新增公司自訂職稱）。
 *
 * **沒有稽核**：「部門、職稱及職務異動」（計畫 §6）指的是員工被指派了哪個職稱／職務（歷史表的
 * 異動），不是公司維護自己職稱主檔這件事——與 `departments/main` 的 CRUD 至今沒有 `recordAudit`
 * 是同一個判斷（見該模組各 impl 檔頭）。
 *
 * **本檔不開交易**：`createJobTitleInTransaction` 只收外部交易 handle（`TransactionRunner`），
 * 開交易的包裝在入口檔的 `createJobTitle`，理由與 `departments-main.create.service.ts` 相同。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { JobTitleStatus } from '../../../../db/schema/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitlesMainContext } from '../domain/job-title-context.ts'
import type { CreateJobTitleInput, JobTitleDetail } from '../domain/job-title-model.ts'
import { jobTitleCodeDuplicated } from '../job-titles-main.errors.ts'
import { findJobTitleDetail, insertJobTitle } from '../job-titles-main.repository.ts'

export const createJobTitleInTransaction = async (
  tx: TransactionRunner,
  context: JobTitlesMainContext,
  input: CreateJobTitleInput,
): Promise<ServiceResult<JobTitleDetail>> => {
  const now = context.clock.now()
  const jobTitleId = crypto.randomUUID()

  // 代碼唯一性交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）。
  const outcome = await insertJobTitle(tx, context.companyId, {
    id: jobTitleId,
    code: input.code,
    name: input.name,
    description: input.description,
    status: JobTitleStatus.Active,
    now,
  })
  if (outcome === 'duplicate-code') return fail([jobTitleCodeDuplicated()])

  const detail = await findJobTitleDetail(tx, context.companyId, jobTitleId)
  if (detail === null) {
    throw new Error(`職稱 ${jobTitleId} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}
