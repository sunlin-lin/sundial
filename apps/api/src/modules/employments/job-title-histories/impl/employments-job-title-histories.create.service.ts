/**
 * 業務動作：新增職稱歷史。
 *
 * ## §4.3 期間重疊：鎖的粒度＝任職
 *
 * 與 `department-histories` 的 `create` 完全同一套手法：
 * 1. 對 `employee_employments` 那一列 `SELECT ... FOR UPDATE`。
 * 2. 鎖到手後在同一交易內查出這筆任職**目前全部**的職稱歸屬期間，用 `overlapsAnyPeriod` 判斷
 *    新期間會不會重疊。
 * 3. `uq_employee_job_title_histories_employment_from` 唯一鍵是最後一道保險。
 *
 * 同樣不完美，處置與殘留風險見 `employments-main.create.service.ts` 檔頭，逐字適用。
 *
 * **本檔不開交易**：`createJobTitleHistoryInTransaction` 只收外部交易 handle
 * （`TransactionRunner`），開交易的包裝在入口檔的 `createJobTitleHistory`。
 *
 * **稽核與寫入同一交易**：`recordAudit` 收 `TransactionRunner`，理由與其餘歷史表相同。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod } from '../../../../shared/effective-period.ts'
import type { JobTitleHistoriesContext } from '../domain/job-title-history-context.ts'
import type {
  CreateJobTitleHistoryInput,
  JobTitleHistoryAuditSnapshot,
  JobTitleHistoryDetail,
} from '../domain/job-title-history-model.ts'
import {
  jobTitleHistoryDuplicateEffectiveFrom,
  jobTitleHistoryEmploymentNotFound,
  jobTitleHistoryJobTitleNotFound,
  jobTitleHistoryPeriodOverlap,
} from '../employments-job-title-histories.errors.ts'
import {
  findEmploymentForUpdate,
  findJobTitleForReference,
  insertJobTitleHistory,
  listJobTitleHistoryPeriods,
} from '../employments-job-title-histories.repository.ts'

export const createJobTitleHistoryInTransaction = async (
  tx: TransactionRunner,
  context: JobTitleHistoriesContext,
  input: CreateJobTitleHistoryInput,
): Promise<ServiceResult<JobTitleHistoryDetail>> => {
  const now = context.clock.now()
  const historyId = crypto.randomUUID()

  // 鎖的粒度＝任職（見檔頭）。
  const employment = await findEmploymentForUpdate(tx, context.companyId, input.employmentId)
  if (employment === null) return fail([jobTitleHistoryEmploymentNotFound()])

  const jobTitle = await findJobTitleForReference(tx, context.companyId, input.jobTitleId)
  if (jobTitle === null) return fail([jobTitleHistoryJobTitleNotFound()])

  const existingPeriods = await listJobTitleHistoryPeriods(tx, context.companyId, input.employmentId)
  const overlaps = overlapsAnyPeriod(existingPeriods, {
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  })
  if (overlaps) return fail([jobTitleHistoryPeriodOverlap()])

  const outcome = await insertJobTitleHistory(tx, context.companyId, {
    id: historyId,
    employmentId: input.employmentId,
    jobTitleId: input.jobTitleId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    now,
  })
  if (outcome === 'duplicate-effective-from') return fail([jobTitleHistoryDuplicateEffectiveFrom()])

  const after: JobTitleHistoryAuditSnapshot = {
    jobTitleId: input.jobTitleId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.job-title-histories.create',
    subjectTable: 'employee_job_title_histories',
    subjectId: historyId,
    changes: buildAuditChanges('employee_job_title_histories', null, after),
    effectiveDate: input.effectiveFrom,
    now,
  })

  return succeed({
    id: historyId,
    employmentId: input.employmentId,
    jobTitleId: input.jobTitleId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdAt: now,
    updatedAt: now,
  })
}
