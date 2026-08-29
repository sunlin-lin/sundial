/**
 * 業務動作：刪除職稱（軟刪除）。
 *
 * **本輪不檢查「是否仍被員工引用」**：字典與 UI 定案都沒有像 `departments`「有子部門或有效成員
 * 不得刪除」那樣的明文規則，`employee_job_title_histories.job_title_id` 是單欄外鍵（見該表 schema
 * 檔頭），刪除職稱不會撞外鍵、也不會讓既有歷史列跑到別的職稱底下——只是那筆歷史往後查回去的
 * 職稱會顯示成「已停用」（`status`）或「已刪除」（`deleted_at`），與 `departments` 對「停用不動
 * 歷史」的既有處置一致。**這是本次交付的判斷，不是字典明文，已在回報中列出。**
 *
 * 系統預設職稱同樣回 `NotFound`，理由與 `update` 切片相同。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { JobTitlesMainContext } from '../domain/job-title-context.ts'
import type { DeletedJobTitle, JobTitleTargetInput } from '../domain/job-title-model.ts'
import { jobTitleNotFound, jobTitleStateChanged } from '../job-titles-main.errors.ts'
import { findJobTitleDetail, markJobTitleDeleted } from '../job-titles-main.repository.ts'

export const deleteJobTitleInTransaction = async (
  tx: TransactionRunner,
  context: JobTitlesMainContext,
  input: JobTitleTargetInput,
): Promise<ServiceResult<DeletedJobTitle>> => {
  const now = context.clock.now()
  // 用刪除當下的 epoch 毫秒當 deletedSeq（§4.3），理由與 `departments` 同構。
  const deletedSeq = context.clock.epochMs()

  const current = await findJobTitleDetail(tx, context.companyId, input.id)
  if (current === null || current.isSystem) return fail([jobTitleNotFound()])

  const affectedRows = await markJobTitleDeleted(tx, context.companyId, input.id, { now, deletedSeq })
  if (affectedRows === 0) return fail([jobTitleStateChanged()])

  return succeed({ id: input.id })
}
