import { describe, expect, test } from 'bun:test'
import {
  EMPLOYMENT_LIST_SORT,
  HISTORY_LIST_SORT_ECHO,
  ROLE_ASSIGNMENT_LIST_SORT,
  toBasicInfoFormState,
  toBasicInfoUpdatePayload,
  toDepartmentHistoryListQuery,
  toDepartmentHistoryPayload,
  toEmploymentCreatePayload,
  toEmploymentLeavePayload,
  toEmploymentListQuery,
  toJobPositionHistoryPayload,
  toJobTitleHistoryPayload,
  toResetPasswordPayload,
  toRoleAssignmentListQuery,
  toRoleAssignPayload,
  toRoleRevokePayload,
  toWithholdingCreatePayload,
  type BasicInfoFormState,
  type DepartmentHistoryFormState,
  type EmploymentCreateFormState,
  type EmploymentLeaveFormState,
  type JobPositionHistoryFormState,
  type JobTitleHistoryFormState,
  type ResetPasswordFormState,
  type RoleAssignFormState,
  type WithholdingCreateFormState,
} from './employees-detail.payload.ts'

describe('toBasicInfoFormState', () => {
  test('null 時回全空白表單', () => {
    const form = toBasicInfoFormState(null)
    expect(form).toEqual({
      employeeCode: '',
      name: '',
      gender: '',
      identityNumber: '',
      birthday: '',
      phone: '',
      email: '',
      address: '',
    })
  })

  test('有員工資料時只帶出 employeeCode／name／gender，敏感欄位一律留白（見檔頭：get 只回遮罩值）', () => {
    const employee = {
      id: 'emp-1',
      employeeCode: 'A001',
      name: '王小明',
      gender: 'MALE' as const,
      identityNumberMasked: 'A1****6789',
      birthdayMasked: '****-01-01',
      phoneMasked: '09****5678',
      emailMasked: null,
      addressMasked: '****',
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    }
    const form = toBasicInfoFormState(employee)
    expect(form.employeeCode).toBe('A001')
    expect(form.name).toBe('王小明')
    expect(form.gender).toBe('MALE')
    expect(form.identityNumber).toBe('')
    expect(form.birthday).toBe('')
  })
})

describe('toBasicInfoUpdatePayload', () => {
  const buildForm = (overrides: Partial<BasicInfoFormState> = {}): BasicInfoFormState => ({
    employeeCode: 'A001',
    name: '王小明',
    gender: 'MALE',
    identityNumber: 'A123456789',
    birthday: '1990-01-01',
    phone: '0912345678',
    email: '',
    address: '台北市',
    ...overrides,
  })

  test('email 空白時整個鍵省略', () => {
    const payload = toBasicInfoUpdatePayload('emp-1', buildForm())
    expect('email' in payload).toBe(false)
  })

  test('email 有填才出現在 payload 裡', () => {
    const payload = toBasicInfoUpdatePayload('emp-1', buildForm({ email: 'a@example.com' }))
    expect(payload.email).toBe('a@example.com')
  })

  test('gender 還沒選就送出時丟出錯誤', () => {
    expect(() => toBasicInfoUpdatePayload('emp-1', buildForm({ gender: '' }))).toThrow()
  })

  test('字串欄位裁掉前後空白', () => {
    const payload = toBasicInfoUpdatePayload('emp-1', buildForm({ name: '  王小明  ' }))
    expect(payload.name).toBe('王小明')
  })
})

describe('toEmploymentCreatePayload', () => {
  test('employmentTypeCode 未選就送出時丟出錯誤', () => {
    const form: EmploymentCreateFormState = {
      employmentTypeCode: 0,
      employmentNatureCode: null,
      hireDate: '2026-01-01',
    }
    expect(() => toEmploymentCreatePayload('emp-1', form)).toThrow()
  })

  test('employmentNatureCode 未填時整個鍵省略', () => {
    const form: EmploymentCreateFormState = {
      employmentTypeCode: 1,
      employmentNatureCode: null,
      hireDate: '2026-01-01',
    }
    const payload = toEmploymentCreatePayload('emp-1', form)
    expect('employmentNatureCode' in payload).toBe(false)
    expect(payload.employmentTypeCode).toBe(1)
  })
})

describe('toEmploymentLeavePayload', () => {
  test('leaveReasonCode 未填就送出時丟出錯誤', () => {
    const form: EmploymentLeaveFormState = {
      leaveDate: '2026-06-30',
      lastWorkingDate: '2026-06-29',
      leaveReasonCode: null,
    }
    expect(() => toEmploymentLeavePayload('employment-1', form)).toThrow()
  })

  test('齊全時組出完整 payload', () => {
    const form: EmploymentLeaveFormState = {
      leaveDate: '2026-06-30',
      lastWorkingDate: '2026-06-29',
      leaveReasonCode: 1,
    }
    const payload = toEmploymentLeavePayload('employment-1', form)
    expect(payload).toEqual({
      id: 'employment-1',
      leaveDate: '2026-06-30',
      lastWorkingDate: '2026-06-29',
      leaveReasonCode: 1,
    })
  })
})

describe('toDepartmentHistoryPayload', () => {
  test('departmentId 未選就送出時丟出錯誤', () => {
    const form: DepartmentHistoryFormState = { departmentId: null, effectiveFrom: '2026-01-01', effectiveTo: '' }
    expect(() => toDepartmentHistoryPayload('employment-1', form)).toThrow()
  })

  test('effectiveTo 空字串時整個鍵省略', () => {
    const form: DepartmentHistoryFormState = { departmentId: 'dept-1', effectiveFrom: '2026-01-01', effectiveTo: '' }
    const payload = toDepartmentHistoryPayload('employment-1', form)
    expect('effectiveTo' in payload).toBe(false)
  })

  test('effectiveTo 有填才帶入 payload', () => {
    const form: DepartmentHistoryFormState = {
      departmentId: 'dept-1',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    }
    const payload = toDepartmentHistoryPayload('employment-1', form)
    expect(payload.effectiveTo).toBe('2026-12-31')
  })
})

describe('toJobTitleHistoryPayload', () => {
  test('jobTitleId 未選就送出時丟出錯誤', () => {
    const form: JobTitleHistoryFormState = { jobTitleId: null, effectiveFrom: '2026-01-01', effectiveTo: '' }
    expect(() => toJobTitleHistoryPayload('employment-1', form)).toThrow()
  })
})

describe('toJobPositionHistoryPayload', () => {
  test('jobPositionIds 空陣列就送出時丟出錯誤', () => {
    const form: JobPositionHistoryFormState = { jobPositionIds: [], effectiveFrom: '2026-01-01', effectiveTo: '' }
    expect(() => toJobPositionHistoryPayload('employment-1', form)).toThrow()
  })

  test('齊全時組出完整 payload', () => {
    const form: JobPositionHistoryFormState = {
      jobPositionIds: ['jp-1', 'jp-2'],
      effectiveFrom: '2026-01-01',
      effectiveTo: '',
    }
    const payload = toJobPositionHistoryPayload('employment-1', form)
    expect(payload.jobPositionIds).toEqual(['jp-1', 'jp-2'])
  })
})

describe('toWithholdingCreatePayload', () => {
  test('withholdingMethodCode 未選就送出時丟出錯誤', () => {
    const form: WithholdingCreateFormState = { withholdingMethodCode: 0, effectiveFrom: '2026-01-01', effectiveTo: '' }
    expect(() => toWithholdingCreatePayload('emp-1', form)).toThrow()
  })
})

describe('列表查詢型別', () => {
  test('toEmploymentListQuery 帶固定排序（到職日新到舊）', () => {
    const query = toEmploymentListQuery('emp-1', 2)
    expect(query).toEqual({ employeeId: 'emp-1', currentPage: 2, perPage: 20, sort: EMPLOYMENT_LIST_SORT })
  })

  test('toDepartmentHistoryListQuery 帶固定的回聲排序常數（後端不接受 sort 參數）', () => {
    const query = toDepartmentHistoryListQuery('employment-1', 1)
    expect(query.sort).toEqual(HISTORY_LIST_SORT_ECHO)
    expect(query.employmentId).toBe('employment-1')
  })
})

describe('toRoleAssignPayload', () => {
  test('roleIds 空陣列就送出時丟出錯誤', () => {
    const form: RoleAssignFormState = { roleIds: [] }
    expect(() => toRoleAssignPayload('company-user-1', form)).toThrow()
  })

  test('齊全時組出完整 payload', () => {
    const form: RoleAssignFormState = { roleIds: ['role-1', 'role-2'] }
    const payload = toRoleAssignPayload('company-user-1', form)
    expect(payload).toEqual({ companyUserId: 'company-user-1', roleIds: ['role-1', 'role-2'] })
  })
})

describe('toRoleRevokePayload', () => {
  test('由 companyUserId 與單一 roleId 組出 payload（沒有表單狀態）', () => {
    const payload = toRoleRevokePayload('company-user-1', 'role-1')
    expect(payload).toEqual({ companyUserId: 'company-user-1', roleIds: ['role-1'] })
  })
})

describe('toResetPasswordPayload', () => {
  test('由 companyUserId 與表單值組出 payload', () => {
    const form: ResetPasswordFormState = { newPassword: 'new-secret-1' }
    const payload = toResetPasswordPayload('company-user-1', form)
    expect(payload).toEqual({ companyUserId: 'company-user-1', newPassword: 'new-secret-1' })
  })
})

describe('toRoleAssignmentListQuery', () => {
  test('固定排序（最近指派在前）、只查未撤銷的指派', () => {
    const query = toRoleAssignmentListQuery('company-user-1', 1)
    expect(query).toEqual({
      companyUserId: 'company-user-1',
      includeRevoked: false,
      currentPage: 1,
      perPage: 20,
      sort: ROLE_ASSIGNMENT_LIST_SORT,
    })
  })
})
