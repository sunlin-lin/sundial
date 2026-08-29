/** 資料存取：新增扣繳設定。理由與 `employments-main.insert.repository.ts` 同構。 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeWithholdingSettings, type WithholdingMethodCodeValue } from '../../../../db/schema/index.ts'
import {
  isDuplicateWithholdingSettingEffectiveFrom,
  type WithholdingSettingInsertOutcome,
} from '../domain/withholding-duplicate.ts'

export type NewWithholdingSetting = {
  readonly id: string
  readonly employeeId: string
  readonly withholdingMethodCode: WithholdingMethodCodeValue
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly now: string
}

export const insertWithholdingSetting = async (
  runner: QueryRunner,
  companyId: string,
  setting: NewWithholdingSetting,
): Promise<WithholdingSettingInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(employeeWithholdingSettings, (scopedCompanyId) => ({
      id: setting.id,
      companyId: scopedCompanyId,
      employeeId: setting.employeeId,
      withholdingMethodCode: setting.withholdingMethodCode,
      effectiveFrom: setting.effectiveFrom,
      effectiveTo: setting.effectiveTo,
      createdAt: setting.now,
      updatedAt: setting.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateWithholdingSettingEffectiveFrom(error)) return 'duplicate-effective-from'
    throw error
  }
}
