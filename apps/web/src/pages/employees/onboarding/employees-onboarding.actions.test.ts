import { describe, expect, test } from 'bun:test'
import { canSubmitOnboardingForm } from './employees-onboarding.actions.ts'
import { emptyOnboardingFormState, type EmployeeOnboardingFormState } from './employees-onboarding.payload.ts'

const filledForm = (overrides: Partial<EmployeeOnboardingFormState> = {}): EmployeeOnboardingFormState => ({
  ...emptyOnboardingFormState(),
  employeeCode: 'A001',
  name: '王小明',
  gender: 'MALE',
  identityNumber: 'A123456789',
  birthday: '1990-01-01',
  phone: '0912345678',
  address: '台北市',
  employmentTypeCode: 1,
  hireDate: '2026-01-01',
  departmentId: 'dept-1',
  withholdingMethodCode: 1,
  username: 'A001',
  initialPassword: 'password123',
  roleIds: ['role-1'],
  ...overrides,
})

describe('canSubmitOnboardingForm', () => {
  test('必填欄位齊全、沒有請求進行中時可以送出', () => {
    expect(canSubmitOnboardingForm({ isSubmitting: false, isLoadingDictionaries: false, form: filledForm() })).toBe(
      true,
    )
  })

  test('送出中不得再按一次（§6.2 防重複點擊）', () => {
    expect(canSubmitOnboardingForm({ isSubmitting: true, isLoadingDictionaries: false, form: filledForm() })).toBe(
      false,
    )
  })

  test('字典還在載入中不能送出', () => {
    expect(canSubmitOnboardingForm({ isSubmitting: false, isLoadingDictionaries: true, form: filledForm() })).toBe(
      false,
    )
  })

  test('缺任何一個必填欄位都不能送出', () => {
    const requiredOverrides: Partial<EmployeeOnboardingFormState>[] = [
      { employeeCode: '' },
      { name: '' },
      { gender: '' },
      { identityNumber: '' },
      { birthday: '' },
      { phone: '' },
      { address: '' },
      { employmentTypeCode: 0 },
      { hireDate: '' },
      { departmentId: null },
      { withholdingMethodCode: 0 },
      { username: '' },
      { initialPassword: '' },
      { roleIds: [] },
    ]

    for (const overrides of requiredOverrides) {
      const ok = canSubmitOnboardingForm({
        isSubmitting: false,
        isLoadingDictionaries: false,
        form: filledForm(overrides),
      })
      expect(ok).toBe(false)
    }
  })

  test('選填欄位（email、任職性質、職稱、職務）留空不影響送出', () => {
    expect(
      canSubmitOnboardingForm({
        isSubmitting: false,
        isLoadingDictionaries: false,
        form: filledForm({ email: '', employmentNatureCode: null, jobTitleId: null, jobPositionIds: [] }),
      }),
    ).toBe(true)
  })
})
