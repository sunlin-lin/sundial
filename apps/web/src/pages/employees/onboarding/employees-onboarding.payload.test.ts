import { describe, expect, test } from 'bun:test'
import {
  emptyOnboardingFormState,
  toOnboardingCreatePayload,
  type EmployeeOnboardingFormState,
} from './employees-onboarding.payload.ts'

/** 一份填滿必填欄位的表單狀態，測試各自只覆寫要斷言的欄位。 */
const buildForm = (overrides: Partial<EmployeeOnboardingFormState> = {}): EmployeeOnboardingFormState => ({
  ...emptyOnboardingFormState(),
  employeeCode: 'A001',
  name: '王小明',
  gender: 'MALE',
  identityNumber: 'A123456789',
  birthday: '1990-01-01',
  phone: '0912345678',
  address: '台北市信義區',
  employmentTypeCode: 1,
  hireDate: '2026-01-01',
  departmentId: 'dept-1',
  withholdingMethodCode: 1,
  username: 'A001',
  initialPassword: 'password123',
  roleIds: ['role-1'],
  ...overrides,
})

describe('toOnboardingCreatePayload', () => {
  test('必填欄位齊全時組出完整 payload，選填欄位未填就整個省略', () => {
    const payload = toOnboardingCreatePayload(buildForm())

    expect(payload.employeeCode).toBe('A001')
    expect(payload.departmentId).toBe('dept-1')
    expect(payload.roleIds).toEqual(['role-1'])
    expect('email' in payload).toBe(false)
    expect('employmentNatureCode' in payload).toBe(false)
    expect('jobTitleId' in payload).toBe(false)
    expect('jobPositionIds' in payload).toBe(false)
  })

  test('email 有填才出現在 payload 裡', () => {
    const payload = toOnboardingCreatePayload(buildForm({ email: 'a@example.com' }))

    expect(payload.email).toBe('a@example.com')
  })

  test('職務選了才帶 jobPositionIds，空陣列時完全省略這個鍵（避免撞 minItems:1）', () => {
    const withPositions = toOnboardingCreatePayload(buildForm({ jobPositionIds: ['jp-1', 'jp-2'] }))
    expect(withPositions.jobPositionIds).toEqual(['jp-1', 'jp-2'])

    const withoutPositions = toOnboardingCreatePayload(buildForm({ jobPositionIds: [] }))
    expect('jobPositionIds' in withoutPositions).toBe(false)
  })

  test('姓名與地址等欄位會裁掉前後空白', () => {
    const payload = toOnboardingCreatePayload(buildForm({ name: '  王小明  ', address: '  台北市  ' }))

    expect(payload.name).toBe('王小明')
    expect(payload.address).toBe('台北市')
  })

  test('必填的聯集欄位還沒選就送出時丟出錯誤，不悄悄帶一個假值出去', () => {
    expect(() => toOnboardingCreatePayload(buildForm({ gender: '' }))).toThrow()
    expect(() => toOnboardingCreatePayload(buildForm({ employmentTypeCode: 0 }))).toThrow()
    expect(() => toOnboardingCreatePayload(buildForm({ departmentId: null }))).toThrow()
    expect(() => toOnboardingCreatePayload(buildForm({ withholdingMethodCode: 0 }))).toThrow()
  })
})
