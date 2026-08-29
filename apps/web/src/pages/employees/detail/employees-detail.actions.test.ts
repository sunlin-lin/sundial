import { describe, expect, test } from 'bun:test'
import {
  canAssignRole,
  canCreateDependent,
  canCreateDepartmentHistory,
  canCreateEmployment,
  canCreateJobPositionHistory,
  canCreateJobTitleHistory,
  canCreateLaborPension,
  canCreateWithholding,
  canEditBasicInfo,
  canLeaveEmployment,
  canResetPassword,
  canRevokeRole,
  canSubmitBasicInfoForm,
  canSubmitDependentCreateForm,
  canSubmitDependentTerminateForm,
  canSubmitDepartmentHistoryForm,
  canSubmitEmploymentCreateForm,
  canSubmitEmploymentLeaveForm,
  canSubmitJobPositionHistoryForm,
  canSubmitJobTitleHistoryForm,
  canSubmitLaborPensionCreateForm,
  canSubmitResetPasswordForm,
  canSubmitRoleAssignForm,
  canSubmitWithholdingCreateForm,
  canTerminateDependent,
} from './employees-detail.actions.ts'
import {
  emptyDependentCreateFormState,
  emptyDependentTerminateFormState,
  emptyDepartmentHistoryFormState,
  emptyEmploymentCreateFormState,
  emptyEmploymentLeaveFormState,
  emptyJobPositionHistoryFormState,
  emptyJobTitleHistoryFormState,
  emptyLaborPensionCreateFormState,
  emptyResetPasswordFormState,
  emptyRoleAssignFormState,
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

describe('canCreateDependent／canSubmitDependentCreateForm', () => {
  test('權限碼對應 dependents.main.create', () => {
    expect(canCreateDependent(allow('dependents.main.create'))).toBe(true)
    expect(canCreateDependent(denyAll)).toBe(false)
  })

  test('姓名、身分證字號、出生日期、關係、扶養起日五缺一即不可送出', () => {
    const empty = emptyDependentCreateFormState()
    expect(canSubmitDependentCreateForm({ isSubmitting: false, form: empty })).toBe(false)

    const filled = {
      ...empty,
      name: '王小華',
      identityNumber: 'A223456789',
      birthday: '2015-01-01',
      relationshipCode: 4 as const,
      effectiveDate: '2026-01-01',
    }
    expect(canSubmitDependentCreateForm({ isSubmitting: false, form: filled })).toBe(true)
    expect(canSubmitDependentCreateForm({ isSubmitting: true, form: filled })).toBe(false)
  })
})

describe('canTerminateDependent／canSubmitDependentTerminateForm', () => {
  test('UI 定案 §3.4：只有扶養中（ACTIVE）的眷屬能終止，已終止的不能再終止', () => {
    const allowTerminate = allow('dependents.main.terminate')
    expect(canTerminateDependent(allowTerminate, 'ACTIVE')).toBe(true)
    expect(canTerminateDependent(allowTerminate, 'TERMINATED')).toBe(false)
    expect(canTerminateDependent(denyAll, 'ACTIVE')).toBe(false)
  })

  test('扶養迄日必填，送出中不能再送出', () => {
    const empty = emptyDependentTerminateFormState()
    expect(canSubmitDependentTerminateForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(canSubmitDependentTerminateForm({ isSubmitting: false, form: { endDate: '2026-06-30' } })).toBe(true)
    expect(canSubmitDependentTerminateForm({ isSubmitting: true, form: { endDate: '2026-06-30' } })).toBe(false)
  })
})

describe('canCreateLaborPension／canSubmitLaborPensionCreateForm', () => {
  test('權限碼對應 labor-pension.main.create', () => {
    expect(canCreateLaborPension(allow('labor-pension.main.create'))).toBe(true)
    expect(canCreateLaborPension(denyAll)).toBe(false)
  })

  test('提繳率與生效日齊全才能送出（格式交給後端 300，這裡只檢查必填）', () => {
    const empty = emptyLaborPensionCreateFormState()
    expect(canSubmitLaborPensionCreateForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(
      canSubmitLaborPensionCreateForm({
        isSubmitting: false,
        form: { ...empty, voluntaryContributionRate: '0.0600', effectiveFrom: '2026-01-01' },
      }),
    ).toBe(true)
  })
})

describe('canAssignRole／canResetPassword', () => {
  test('各自對應自己的權限碼', () => {
    expect(canAssignRole(allow('company-users.roles.create'))).toBe(true)
    expect(canAssignRole(denyAll)).toBe(false)
    expect(canResetPassword(allow('company-users.main.reset-password'))).toBe(true)
    expect(canResetPassword(denyAll)).toBe(false)
  })
})

describe('canSubmitRoleAssignForm', () => {
  test('至少選一個角色才能送出，送出中不能再送出', () => {
    const empty = emptyRoleAssignFormState()
    expect(canSubmitRoleAssignForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(canSubmitRoleAssignForm({ isSubmitting: false, form: { roleIds: ['role-1'] } })).toBe(true)
    expect(canSubmitRoleAssignForm({ isSubmitting: true, form: { roleIds: ['role-1'] } })).toBe(false)
  })
})

describe('canRevokeRole', () => {
  test('UI 定案 §3.5「系統禁止移除最後一個角色」：剩餘角色數為 1 時，即使有權限也不能按', () => {
    const allowRevoke = allow('company-users.roles.revoke')
    expect(canRevokeRole(allowRevoke, 2)).toBe(true)
    expect(canRevokeRole(allowRevoke, 1)).toBe(false)
    expect(canRevokeRole(denyAll, 2)).toBe(false)
  })
})

describe('canSubmitResetPasswordForm', () => {
  test('長度需落在 8～128（後端 NewPassword schema），送出中不能再送出', () => {
    const empty = emptyResetPasswordFormState()
    expect(canSubmitResetPasswordForm({ isSubmitting: false, form: empty })).toBe(false)
    expect(canSubmitResetPasswordForm({ isSubmitting: false, form: { newPassword: '1234567' } })).toBe(false)
    expect(canSubmitResetPasswordForm({ isSubmitting: false, form: { newPassword: '12345678' } })).toBe(true)
    expect(canSubmitResetPasswordForm({ isSubmitting: false, form: { newPassword: 'a'.repeat(128) } })).toBe(true)
    expect(canSubmitResetPasswordForm({ isSubmitting: false, form: { newPassword: 'a'.repeat(129) } })).toBe(false)
    expect(canSubmitResetPasswordForm({ isSubmitting: true, form: { newPassword: '12345678' } })).toBe(false)
  })
})
