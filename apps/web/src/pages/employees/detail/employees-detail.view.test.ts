import { describe, expect, test } from 'bun:test'
import {
  activeOnly,
  assignableRoleOptions,
  companyUserIdOf,
  dependentRelationshipLabel,
  dependentStatusLabel,
  dependentStatusTagType,
  employmentStatusLabel,
  employmentStatusTagType,
  employmentTypeLabel,
  formatOpenCode,
  isCurrentlyEffective,
  withholdingMethodLabel,
  type AssignableRoleItem,
  type EmployeeSummary,
  type RoleAssignmentItem,
} from './employees-detail.view.ts'

const buildEmployee = (companyUserId?: string | null): EmployeeSummary => ({
  id: 'emp-1',
  employeeCode: 'A001',
  name: '王小明',
  gender: 'MALE',
  identityNumberMasked: 'A1****6789',
  birthdayMasked: '****-01-01',
  phoneMasked: '09****5678',
  emailMasked: null,
  addressMasked: '****',
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
  ...(companyUserId === undefined ? {} : { companyUserId }),
})

const $t = (key: string): string => key

describe('employmentTypeLabel', () => {
  test('依代碼查對應的文字 key', () => {
    expect(employmentTypeLabel(1, $t)).toBe('employees-onboarding.employment-type.1')
    expect(employmentTypeLabel(8, $t)).toBe('employees-onboarding.employment-type.8')
  })
})

describe('withholdingMethodLabel', () => {
  test('依代碼查對應的文字 key', () => {
    expect(withholdingMethodLabel(1, $t)).toBe('employees-onboarding.withholding-method.1')
    expect(withholdingMethodLabel(2, $t)).toBe('employees-onboarding.withholding-method.2')
  })
})

describe('employmentStatusLabel／employmentStatusTagType', () => {
  test('在職與離職各自對應不同文字與 tag 顏色', () => {
    expect(employmentStatusLabel('ACTIVE', $t)).toBe('employees-detail.employment-status.active')
    expect(employmentStatusLabel('LEFT', $t)).toBe('employees-detail.employment-status.left')
    expect(employmentStatusTagType('ACTIVE')).toBe('success')
    expect(employmentStatusTagType('LEFT')).toBe('info')
  })
})

describe('formatOpenCode', () => {
  test('有值原樣轉字串，null 顯示空值符號', () => {
    expect(formatOpenCode(3)).toBe('3')
    expect(formatOpenCode(null)).toBe('—')
  })
})

describe('dependentRelationshipLabel', () => {
  test('依代碼查對應的文字 key', () => {
    expect(dependentRelationshipLabel(1, $t)).toBe('employees-detail.dependent.relationship.1')
    expect(dependentRelationshipLabel(4, $t)).toBe('employees-detail.dependent.relationship.4')
    expect(dependentRelationshipLabel(8, $t)).toBe('employees-detail.dependent.relationship.8')
  })
})

describe('dependentStatusLabel／dependentStatusTagType', () => {
  test('扶養中與已終止各自對應不同文字與 tag 顏色（終止是狀態變更，不是刪除）', () => {
    expect(dependentStatusLabel('ACTIVE', $t)).toBe('employees-detail.dependent.status.active')
    expect(dependentStatusLabel('TERMINATED', $t)).toBe('employees-detail.dependent.status.terminated')
    expect(dependentStatusTagType('ACTIVE')).toBe('success')
    expect(dependentStatusTagType('TERMINATED')).toBe('info')
  })
})

describe('activeOnly', () => {
  test('只留下 status 為 ACTIVE 的項目', () => {
    const items = [{ status: 'ACTIVE' as const }, { status: 'INACTIVE' as const }]
    expect(activeOnly(items)).toEqual([{ status: 'ACTIVE' }])
  })
})

describe('isCurrentlyEffective', () => {
  test('today 落在 [effectiveFrom, effectiveTo] 之間才算目前生效', () => {
    expect(isCurrentlyEffective('2026-01-01', '2026-12-31', '2026-06-01')).toBe(true)
    expect(isCurrentlyEffective('2026-01-01', '2026-12-31', '2027-01-01')).toBe(false)
    expect(isCurrentlyEffective('2026-01-01', '2026-12-31', '2025-12-31')).toBe(false)
  })

  test('effectiveTo 為 null 代表沒有結束日，today 只要不早於 effectiveFrom 就算生效', () => {
    expect(isCurrentlyEffective('2026-01-01', null, '2099-01-01')).toBe(true)
    expect(isCurrentlyEffective('2026-01-01', null, '2025-01-01')).toBe(false)
  })
})

describe('assignableRoleOptions', () => {
  const managerRole: AssignableRoleItem = {
    id: 'role-2',
    code: 'MANAGER',
    name: '主管',
    status: 'ACTIVE',
    isSystem: false,
  }
  const roles: AssignableRoleItem[] = [
    { id: 'role-1', code: 'HR', name: '人資', status: 'ACTIVE', isSystem: false },
    managerRole,
  ]

  test('排除這個帳號已經有效指派的角色', () => {
    const assignments: RoleAssignmentItem[] = [
      {
        id: 'assignment-1',
        companyUserId: 'company-user-1',
        roleId: 'role-1',
        roleCode: 'HR',
        roleName: '人資',
        assignedAt: '2026-01-01 00:00:00',
        assignedByName: '王小明',
        revokedAt: null,
        revokedByName: null,
      },
    ]
    expect(assignableRoleOptions(roles, assignments)).toEqual([managerRole])
  })

  test('沒有任何指派時回傳完整字典', () => {
    expect(assignableRoleOptions(roles, [])).toEqual(roles)
  })
})

describe('companyUserIdOf', () => {
  test('有值時原樣回傳，缺席或 null 一律收斂成 null', () => {
    expect(companyUserIdOf(buildEmployee('company-user-1'))).toBe('company-user-1')
    expect(companyUserIdOf(buildEmployee(null))).toBeNull()
    expect(companyUserIdOf(buildEmployee())).toBeNull()
  })
})
