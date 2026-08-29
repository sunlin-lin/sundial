/**
 * 業務動作：新增勞退自願提繳率設定。
 *
 * §4.3 期間重疊：鎖的粒度＝員工，手法與 `withholding/main/impl/withholding-main.create.service.ts`
 * 完全同構（同一份殘留風險說明逐字適用，不重複）。
 *
 * ★ `findEmployeeForUpdate` 的 `SELECT ... FOR UPDATE` 是本交易的**第一句資料庫語句**——
 * 這一點在 REPEATABLE READ 下不是風格選擇，是正確性條件：一致性讀快照在第一個查詢那一刻建立，
 * 若把一般 `SELECT` 排在鎖之前，鎖拿到之後做的重疊檢查讀的仍是鎖定前的舊快照，兩個交易會
 * 雙雙判定「沒有重疊」而都寫入成功（Stage 5 職稱／職務歷史踩過這個坑）。因此本檔內任何一次
 * 資料庫存取都不得排在 `findEmployeeForUpdate` 之前。
 *
 * **本檔不開交易**：`createLaborPensionSettingInTransaction` 只收外部交易 handle，開交易的包裝
 * 在入口檔的 `createLaborPensionSetting`。`recordAudit` 收 `TransactionRunner`，傳裸連線池是
 * 編譯錯誤，因此不再需要 `check-audit-transaction.ts` 的詞法巢狀判斷來確認「有沒有交易」。
 *
 * **本次只做「新增一筆」**，不做「結束舊設定並新增一筆」的複合動作——理由與範圍縮小的說明
 * 逐字比照 `withholding-main.create.service.ts` 檔頭，這裡不重複。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod } from '../../../../shared/effective-period.ts'
import type { LaborPensionMainContext } from '../domain/labor-pension-context.ts'
import type {
  CreateLaborPensionSettingInput,
  LaborPensionSettingAuditSnapshot,
  LaborPensionSettingDetail,
} from '../domain/labor-pension-model.ts'
import {
  laborPensionDuplicateEffectiveFrom,
  laborPensionEmployeeNotFound,
  laborPensionPeriodOverlap,
} from '../labor-pension-main.errors.ts'
import {
  findEmployeeForUpdate,
  insertLaborPensionSetting,
  listLaborPensionPeriods,
} from '../labor-pension-main.repository.ts'

export const createLaborPensionSettingInTransaction = async (
  tx: TransactionRunner,
  context: LaborPensionMainContext,
  input: CreateLaborPensionSettingInput,
): Promise<ServiceResult<LaborPensionSettingDetail>> => {
  const now = context.clock.now()
  const settingId = crypto.randomUUID()

  // ★ 本交易的第一句資料庫語句（見檔頭）。
  const employee = await findEmployeeForUpdate(tx, context.companyId, input.employeeId)
  if (employee === null) return fail([laborPensionEmployeeNotFound()])

  const existingPeriods = await listLaborPensionPeriods(tx, context.companyId, input.employeeId)
  const overlaps = overlapsAnyPeriod(existingPeriods, {
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  })
  if (overlaps) return fail([laborPensionPeriodOverlap()])

  const outcome = await insertLaborPensionSetting(tx, context.companyId, {
    id: settingId,
    employeeId: input.employeeId,
    voluntaryContributionRate: input.voluntaryContributionRate,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdBy: context.operatorCompanyUserId,
    now,
  })
  if (outcome === 'duplicate-effective-from') return fail([laborPensionDuplicateEffectiveFrom()])

  const after: LaborPensionSettingAuditSnapshot = {
    voluntaryContributionRate: input.voluntaryContributionRate,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'labor-pension.main.create',
    subjectTable: 'employee_labor_pension_settings',
    subjectId: settingId,
    changes: buildAuditChanges('employee_labor_pension_settings', null, after),
    effectiveDate: input.effectiveFrom,
    now,
  })

  return succeed({
    id: settingId,
    employeeId: input.employeeId,
    voluntaryContributionRate: input.voluntaryContributionRate,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    createdBy: context.operatorCompanyUserId,
    createdAt: now,
    updatedAt: now,
  })
}
