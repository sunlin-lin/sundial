/**
 * 業務動作：新增扣繳設定。
 *
 * §4.3 期間重疊：鎖的粒度＝員工，手法與 `employments/main/impl/employments-main.create.
 * service.ts` 完全同構（同一份殘留風險說明逐字適用，不重複）。交易邊界開在這一層的理由同樣是
 * `check:audit-transaction` 要求 `.transaction(...)` 與 `recordAudit(` 同檔同回呼。
 *
 * **本次只做「新增一筆」**，不做「結束舊設定並新增一筆」的複合動作——資料字典原文雖然是「修改時
 * 結束舊設定並新增一筆」，但那是**修改**流程的行為，本輪任務範圍只要求扣繳設定的「建立／查詢」，
 * 沒有要求「修改」端點。呼叫端目前只能透過「新增一筆不與既有期間重疊的設定」達成同樣效果
 * ——若要結束目前生效中的設定，必須先手動把它的 `effectiveTo` 設定好（本輪沒有對應的端點），
 * 這是刻意縮小的範圍，已在回報中列出。
 */
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { overlapsAnyPeriod } from '../../../../shared/effective-period.ts'
import type { WithholdingMainContext } from '../domain/withholding-context.ts'
import type {
  CreateWithholdingSettingInput,
  WithholdingSettingAuditSnapshot,
  WithholdingSettingDetail,
} from '../domain/withholding-model.ts'
import {
  withholdingDuplicateEffectiveFrom,
  withholdingEmployeeNotFound,
  withholdingPeriodOverlap,
} from '../withholding-main.errors.ts'
import {
  findEmployeeForUpdate,
  insertWithholdingSetting,
  listWithholdingPeriods,
} from '../withholding-main.repository.ts'

export const createWithholdingSetting = async (
  context: WithholdingMainContext,
  input: CreateWithholdingSettingInput,
): Promise<ServiceResult<WithholdingSettingDetail>> => {
  const now = context.clock.now()
  const settingId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<WithholdingSettingDetail>> => {
    const employee = await findEmployeeForUpdate(tx, context.companyId, input.employeeId)
    if (employee === null) return fail([withholdingEmployeeNotFound()])

    const existingPeriods = await listWithholdingPeriods(tx, context.companyId, input.employeeId)
    const overlaps = overlapsAnyPeriod(existingPeriods, {
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    })
    if (overlaps) return fail([withholdingPeriodOverlap()])

    const outcome = await insertWithholdingSetting(tx, context.companyId, {
      id: settingId,
      employeeId: input.employeeId,
      withholdingMethodCode: input.withholdingMethodCode,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      now,
    })
    if (outcome === 'duplicate-effective-from') return fail([withholdingDuplicateEffectiveFrom()])

    const after: WithholdingSettingAuditSnapshot = {
      withholdingMethodCode: input.withholdingMethodCode,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    }

    await recordAudit(tx, {
      companyId: context.companyId,
      actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
      action: 'withholding.main.create',
      subjectTable: 'employee_withholding_settings',
      subjectId: settingId,
      changes: buildAuditChanges('employee_withholding_settings', null, after),
      effectiveDate: input.effectiveFrom,
      now,
    })

    return succeed({
      id: settingId,
      employeeId: input.employeeId,
      withholdingMethodCode: input.withholdingMethodCode,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      createdAt: now,
      updatedAt: now,
    })
  })
}
