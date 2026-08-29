/** 資料存取：新增勞退自願提繳率設定。理由與 `withholding-main.insert.repository.ts` 同構。 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeLaborPensionSettings } from '../../../../db/schema/index.ts'
import {
  isDuplicateLaborPensionSettingEffectiveFrom,
  type LaborPensionSettingInsertOutcome,
} from '../domain/labor-pension-duplicate.ts'

export type NewLaborPensionSetting = {
  readonly id: string
  readonly employeeId: string
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
  readonly now: string
}

export const insertLaborPensionSetting = async (
  runner: QueryRunner,
  companyId: string,
  setting: NewLaborPensionSetting,
): Promise<LaborPensionSettingInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(employeeLaborPensionSettings, (scopedCompanyId) => ({
      id: setting.id,
      companyId: scopedCompanyId,
      employeeId: setting.employeeId,
      voluntaryContributionRate: setting.voluntaryContributionRate,
      effectiveFrom: setting.effectiveFrom,
      effectiveTo: setting.effectiveTo,
      createdBy: setting.createdBy,
      createdAt: setting.now,
      updatedAt: setting.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateLaborPensionSettingEffectiveFrom(error)) return 'duplicate-effective-from'
    throw error
  }
}
