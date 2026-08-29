/**
 * 業務動作：修改職稱（含啟用／停用）。
 *
 * **系統預設職稱回 `NotFound`，不是另一個專屬錯誤碼**：`findJobTitleDetail`（查詢用，含系統預設）
 * 與 `updateJobTitleProfile`（寫入用，`TenantDatabase` 標準 scope）刻意不對稱——本函式先用前者
 * 讀「目前內容」判斷「這筆到底存不存在、找不找得到」；若目標其實是系統預設列，**直接回
 * `NotFound`**，不透露「其實存在，只是不能改」（比照 §3.2 對跨公司資源的處置）。
 *
 * 無稽核，理由同 `create` 切片。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitlesMainContext } from '../domain/job-title-context.ts'
import type { JobTitleDetail, UpdateJobTitleInput } from '../domain/job-title-model.ts'
import { jobTitleCodeDuplicated, jobTitleNotFound } from '../job-titles-main.errors.ts'
import { findJobTitleDetail, updateJobTitleProfile } from '../job-titles-main.repository.ts'

export const updateJobTitleInTransaction = async (
  tx: TransactionRunner,
  context: JobTitlesMainContext,
  input: UpdateJobTitleInput,
): Promise<ServiceResult<JobTitleDetail>> => {
  const now = context.clock.now()

  const current = await findJobTitleDetail(tx, context.companyId, input.id)
  if (current === null || current.isSystem) return fail([jobTitleNotFound()])

  const outcome = await updateJobTitleProfile(tx, context.companyId, input.id, {
    code: input.code,
    name: input.name,
    description: input.description,
    status: input.status,
    now,
  })
  if (outcome === 'duplicate-code') return fail([jobTitleCodeDuplicated()])

  const updated = await findJobTitleDetail(tx, context.companyId, input.id)
  if (updated === null) {
    throw new Error(`職稱 ${input.id} 更新後於同一交易內讀不回來`)
  }
  return succeed(updated)
}
