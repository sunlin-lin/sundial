import { describe, expect, test } from 'bun:test'
import {
  canCreateDepartmentHistory,
  canCreateEmployment,
  canCreateJobPositionHistory,
  canCreateJobTitleHistory,
  canCreateWithholding,
  canEditBasicInfo,
  canLeaveEmployment,
  canSubmitBasicInfoForm,
  canSubmitDepartmentHistoryForm,
  canSubmitEmploymentCreateForm,
  canSubmitEmploymentLeaveForm,
  canSubmitJobPositionHistoryForm,
  canSubmitJobTitleHistoryForm,
  canSubmitWithholdingCreateForm,
} from './employees-detail.actions.ts'
import {
  emptyDepartmentHistoryFormState,
  emptyEmploymentCreateFormState,
  emptyEmploymentLeaveFormState,
  emptyJobPositionHistoryFormState,
  emptyJobTitleHistoryFormState,
  emptyWithholdingCreateFormState,
  toBasicInfoFormState,
} from './employees-detail.payload.ts'

const allow =
  (allowed: string): ((code: string) => boolean) =>
  (code) =>
    code === allowed
const denyAll = (): boolean => false

describe('canEditBasicInfo', () => {
  test('有 employees.main.update 才能編輯', () => {
    expect(canEditBasicInfo(allow('employees.main.update'))).toBe(true)
    expect(canEditBasicInfo(denyAll)).toBe(false)
  })
})

describe('canSubmitBasicInfoForm', () => {
  test('必填欄位齊全才能送出', () => {
    const form = toBasicInfoFormState(null)
    expect(canSubmitBasicInfoForm({ isSubmitting: false, form })).toBe(false)

    const filled = {
      ...form,
      employeeCode: 'A001',
      name: '王小明',
      gender: 'MALE' as const,
      identityNumber: 'A123456789',
      birthday: '1990-01-01',
      phone: '0912345678',
      address: '台北市',
    }
    expect(canSubmitBasicInfoForm({ isSubmitting: false, form: filled })).toBe(true)
    expect(canSubmitBasicInfoForm({ isSubmitting: true, form: filled })).toBe(false)
  })
})

describe('canCreateEmployment／canLeaveEmployment', () => {
  test('有在職中的任職時不能新增任職，只能辦理離職；反之亦然', () => {
    expect(canCreateEmployment(allow('employments.main.create'), false)).toBe(true)
    expect(canCreateEmployment(allow('employments.main.create'), true)).toBe(false)
    expect(canLeaveEmployment(allow('employments.main.leave'), 'employment-1')).toBe(true)
    expect(canLeaveEmployment(allow('employments.main.leave'), null)).toBe(false)
  })
})

describe('canSubmitEmploymentCreateForm', () => {
  test('僱用類型與到職日齊全才能送出', () => {
    const empty = emptyEmploymentCreateFormState()
    expect(canSubmitEmploymentCreateForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitEmploymentCreateForm({
        isSubmitting: false,
        form: { ...empty, employmentTypeCode: 1, hireDate: '2026-01-01' },
      }),
    ).toBe(true)
  })
})

describe('canSubmitEmploymentLeaveForm', () => {
  test('離職日、最後工作日、離職原因三缺一即不可送出，且最後工作日不得晚於離職日', () => {
    const empty = emptyEmploymentLeaveFormState()
    expect(canSubmitEmploymentLeaveForm({ isSubmitting: false, form: empty })).toBe(false)

    const valid = { leaveDate: '2026-06-30', lastWorkingDate: '2026-06-29', leaveReasonCode: 1 }
    expect(canSubmitEmploymentLeaveForm({ isSubmitting: false, form: valid })).toBe(true)

    const outOfOrder = { leaveDate: '2026-06-30', lastWorkingDate: '2026-07-01', leaveReasonCode: 1 }
    expect(canSubmitEmploymentLeaveForm({ isSubmitting: false, form: outOfOrder })).toBe(false)
  })
})

describe('組織資料三支 canSubmitXxxHistoryForm', () => {
  test('部門異動：部門與生效日齊全才能送出', () => {
    const empty = emptyDepartmentHistoryFormState()
    expect(canSubmitDepartmentHistoryForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitDepartmentHistoryForm({
        isSubmitting: false,
        form: { ...empty, departmentId: 'dept-1', effectiveFrom: '2026-01-01' },
      }),
    ).toBe(true)
  })

  test('職稱異動：職稱與生效日齊全才能送出', () => {
    const empty = emptyJobTitleHistoryFormState()
    expect(canSubmitJobTitleHistoryForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitJobTitleHistoryForm({
        isSubmitting: false,
        form: { ...empty, jobTitleId: 'jt-1', effectiveFrom: '2026-01-01' },
      }),
    ).toBe(true)
  })

  test('職務異動：至少一個職務與生效日齊全才能送出', () => {
    const empty = emptyJobPositionHistoryFormState()
    expect(canSubmitJobPositionHistoryForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitJobPositionHistoryForm({
        isSubmitting: false,
        form: { ...empty, jobPositionIds: ['jp-1'], effectiveFrom: '2026-01-01' },
      }),
    ).toBe(true)
  })
})

describe('canCreateDepartmentHistory／canCreateJobTitleHistory／canCreateJobPositionHistory／canCreateWithholding', () => {
  test('各自對應自己的權限碼', () => {
    expect(canCreateDepartmentHistory(allow('employments.department-histories.create'))).toBe(true)
    expect(canCreateJobTitleHistory(allow('employments.job-title-histories.create'))).toBe(true)
    expect(canCreateJobPositionHistory(allow('employments.job-position-histories.create'))).toBe(true)
    expect(canCreateWithholding(allow('withholding.main.create'))).toBe(true)
    expect(canCreateDepartmentHistory(denyAll)).toBe(false)
  })
})

describe('canSubmitWithholdingCreateForm', () => {
  test('扣繳方式與生效日齊全才能送出', () => {
    const empty = emptyWithholdingCreateFormState()
    expect(canSubmitWithholdingCreateForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitWithholdingCreateForm({
        isSubmitting: false,
        form: { ...empty, withholdingMethodCode: 1, effectiveFrom: '2026-01-01' },
      }),
    ).toBe(true)
  })
})
