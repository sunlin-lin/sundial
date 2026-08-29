/** 唯一鍵違反的判讀（零 IO 純函式）。理由與 `withholding/main/domain/withholding-duplicate.ts` 同構。 */
import { isUniqueViolation } from '../../../../db/driver-error.ts'

const LABOR_PENSION_SETTING_EFFECTIVE_FROM_UNIQUE_INDEX = 'uq_employee_labor_pension_settings_employee_from'

export type LaborPensionSettingInsertOutcome = 'inserted' | 'duplicate-effective-from'

export const isDuplicateLaborPensionSettingEffectiveFrom = (error: unknown): boolean =>
  isUniqueViolation(error, LABOR_PENSION_SETTING_EFFECTIVE_FROM_UNIQUE_INDEX)
