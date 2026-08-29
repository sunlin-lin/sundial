/**
 * 送出鈕何時可按（前端規範 §1.3 第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 只做「必填」判斷（§6.1：長度與格式一律交給後端的 `300` 回應，見 `.payload.ts` 檔頭）——
 * 這裡列的每一項都對應 `POST /employees/onboarding/create` schema 的 `required` 陣列
 * （`employees-onboarding.routes.ts`），不是另外想像出來的規則。
 *
 * **至少一個角色**（UI 定案 §2.4「建立帳號時至少指派一個角色」）用 `roleIds.length > 0` 表示，
 * 這一條同時也是 schema 的 `minItems: 1`——兩邊剛好是同一件事的兩種表達方式，不是前端另訂的規則。
 */
import type { EmployeeOnboardingFormState } from './employees-onboarding.payload.ts'

export const canSubmitOnboardingForm = (input: {
  readonly isSubmitting: boolean
  readonly isLoadingDictionaries: boolean
  readonly form: EmployeeOnboardingFormState
}): boolean => {
  if (input.isSubmitting || input.isLoadingDictionaries) return false

  const { form } = input
  return (
    form.employeeCode.trim() !== '' &&
    form.name.trim() !== '' &&
    form.gender !== '' &&
    form.identityNumber.trim() !== '' &&
    form.birthday !== '' &&
    form.phone.trim() !== '' &&
    form.address.trim() !== '' &&
    form.employmentTypeCode !== 0 &&
    form.hireDate !== '' &&
    form.departmentId !== null &&
    form.withholdingMethodCode !== 0 &&
    form.username.trim() !== '' &&
    form.initialPassword !== '' &&
    form.roleIds.length > 0
  )
}
