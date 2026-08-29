/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `employments/main/domain/employment-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const WITHHOLDING_SETTING_EFFECTIVE_FROM_UNIQUE_INDEX = 'uq_employee_withholding_settings_employee_from'

export type WithholdingSettingInsertOutcome = 'inserted' | 'duplicate-effective-from'

export const isDuplicateWithholdingSettingEffectiveFrom = (error: unknown): boolean =>
  isUniqueViolation(error, WITHHOLDING_SETTING_EFFECTIVE_FROM_UNIQUE_INDEX)
