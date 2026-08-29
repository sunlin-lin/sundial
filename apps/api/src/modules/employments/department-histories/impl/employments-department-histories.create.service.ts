/**
 * 業務動作：新增部門歷史。**沒有對外端點**（Stage 3 只交付查詢端點，回報中已說明理由），
 * 保留為業務動作供 Stage 4 編排與併發測試呼叫（§0.4：沒有端點的業務動作一樣放入口檔）。
 *
 * ## §4.3 期間重疊：鎖的粒度＝任職
 *
 * 與 `employments/main/impl/employments-main.create.service.ts` 同一套手法，鎖的對象換成
 * `employee_employments`（見 `impl/employments-department-histories.find-employment-for-update.
 * repository.ts` 檔頭「為什麼鎖任職而不是員工」）：
 *
 * 1. 對 `employee_employments` 那一列 `SELECT ... FOR UPDATE`。
 * 2. 鎖到手後在同一交易內查出這筆任職**目前全部**的部門歸屬期間，用 `overlapsAnyPeriod`
 *    判斷新期間會不會重疊。
 * 3. `uq_employee_department_histories_employment_from` 唯一鍵是最後一道保險。
 *
 * 同樣不完美（處置與殘留風險見 `employments-main.create.service.ts` 檔頭，逐字適用）。
 *
 * ## 交易 handle 由呼叫端傳入（計畫 §4.1）
 *
 * **本檔不開交易**：`createDepartmentHistoryInTransaction` 只收外部交易 handle
 * （`TransactionRunner`，`db/client.ts`），開交易的包裝在入口檔的 `createDepartmentHistory`。
 * `recordAudit` 收 `TransactionRunner`，呼叫端傳裸連線池是編譯錯誤，因此不再需要
 * `check-audit-transaction.ts` 的詞法巢狀判斷來確認「有沒有交易」（該腳本的職責變化見其檔頭）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod } from '../../../../shared/effective-period.ts'
import type { DepartmentHistoriesContext } from '../domain/department-history-context.ts'
import type {
  CreateDepartmentHistoryInput,
  DepartmentHistoryAuditSnapshot,
  DepartmentHistoryDetail,
} from '../domain/department-history-model.ts'
import {
  departmentHistoryDepartmentNotFound,
  departmentHistoryDuplicateEffectiveFrom,
  departmentHistoryEmploymentNotFound,
  departmentHistoryPeriodOverlap,
} from '../employments-department-histories.errors.ts'
import {
  findDepartmentForReference,
  findEmploymentForUpdate,
  insertDepartmentHistory,
  listDepartmentHistoryPeriods,
} from '../employments-department-histories.repository.ts'

export const createDepartmentHistoryInTransaction = async (
  tx: TransactionRunner,
  context: DepartmentHistoriesContext,
  input: CreateDepartmentHistoryInput,
): Promise<ServiceResult<DepartmentHistoryDetail>> => {
  const now = context.clock.now()
  const historyId = crypto.randomUUID()

  // 鎖的粒度＝任職（見檔頭）。
  const employment = await findEmploymentForUpdate(tx, context.companyId, input.employmentId)
  if (employment === null) return fail([departmentHistoryEmploymentNotFound()])

  const department = await findDepartmentForReference(tx, context.companyId, input.departmentId)
  if (department === null) return fail([departmentHistoryDepartmentNotFound()])

  const existingPeriods = await listDepartmentHistoryPeriods(tx, context.companyId, input.employmentId)
  const overlaps = overlapsAnyPeriod(existingPeriods, {
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  })
  if (overlaps) return fail([departmentHistoryPeriodOverlap()])

  const outcome = await insertDepartmentHistory(tx, context.companyId, {
    id: historyId,
    employmentId: input.employmentId,
    departmentId: input.departmentId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    now,
  })
  if (outcome === 'duplicate-effective-from') return fail([departmentHistoryDuplicateEffectiveFrom()])

  const after: DepartmentHistoryAuditSnapshot = {
    departmentId: input.departmentId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.department-histories.create',
    subjectTable: 'employee_department_histories',
    subjectId: historyId,
    changes: buildAuditChanges('employee_department_histories', null, after),
    effectiveDate: input.effectiveFrom,
    now,
  })

  return succeed({
    id: historyId,
    employmentId: input.employmentId,
    departmentId: input.departmentId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdAt: now,
    updatedAt: now,
  })
}
