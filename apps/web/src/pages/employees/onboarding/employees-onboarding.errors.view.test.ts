import { describe, expect, test } from 'bun:test'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import { firstErroredElementId, formItemErrorProp, toOnboardingFormErrors } from './employees-onboarding.errors.view.ts'

const buildError = (code: string, msg: string, field?: string): EnvelopeError => ({
  code,
  msg,
  data: field === undefined ? {} : { field },
})

describe('toOnboardingFormErrors', () => {
  test('已知欄位的錯誤歸進該欄位', () => {
    const result = toOnboardingFormErrors([
      buildError('employees.main.errors.code-duplicated', '員工編號重複', 'employeeCode'),
    ])

    expect(formItemErrorProp(result, 'employeeCode')).toEqual({ error: '員工編號重複' })
    expect(result.generalMessages).toEqual([])
  })

  test('roleIds.<N> 收斂成 roleIds 這一個 key', () => {
    const result = toOnboardingFormErrors([
      buildError('company-users.roles.errors.role-not-found', '角色不存在', 'roleIds.2'),
    ])

    expect(formItemErrorProp(result, 'roleIds')).toEqual({ error: '角色不存在' })
  })

  test('同一欄位可以累加多則訊息', () => {
    const result = toOnboardingFormErrors([
      buildError('company-users.roles.errors.role-not-found', '第一則', 'roleIds.0'),
      buildError('company-users.roles.errors.role-inactive', '第二則', 'roleIds.1'),
    ])

    expect(result.fieldErrors.get('roleIds')).toEqual(['第一則', '第二則'])
  })

  test('對到本表單沒有的內部欄位（如 employeeId）落到全域提示', () => {
    const result = toOnboardingFormErrors([
      buildError('employments.main.errors.employee-not-found', '員工不存在', 'employeeId'),
    ])

    expect(result.generalMessages).toEqual(['員工不存在'])
    expect(formItemErrorProp(result, 'employeeCode')).toEqual({})
  })

  test('完全沒有 field 的錯誤落到全域提示（§6.3 的保底路徑）', () => {
    const result = toOnboardingFormErrors([buildError('some.error', '未分類錯誤')])

    expect(result.generalMessages).toEqual(['未分類錯誤'])
  })

  test('沒有任何錯誤時兩邊都是空的', () => {
    const result = toOnboardingFormErrors([])

    expect(result.fieldErrors.size).toBe(0)
    expect(result.generalMessages).toEqual([])
  })
})

describe('formItemErrorProp', () => {
  test('沒有錯誤時回傳的物件完全不含 error 鍵，不是 { error: undefined }', () => {
    const result = toOnboardingFormErrors([])
    const prop = formItemErrorProp(result, 'employeeCode')

    expect('error' in prop).toBe(false)
  })
})

describe('firstErroredElementId', () => {
  test('依畫面由上到下的順序找到第一個有錯誤的欄位', () => {
    const result = toOnboardingFormErrors([
      buildError('company-users.roles.errors.role-not-found', '角色不存在', 'roleIds.0'),
      buildError('employees.main.errors.code-duplicated', '員工編號重複', 'employeeCode'),
    ])

    // employeeCode 在畫面順序上比 roleIds 早，即使它在 errors 陣列裡排第二個也一樣。
    expect(firstErroredElementId(result)).toBe('employee-onboarding-field-employee-code')
  })

  test('沒有任何欄位級錯誤時回 undefined', () => {
    const result = toOnboardingFormErrors([buildError('some.error', '未分類錯誤')])

    expect(firstErroredElementId(result)).toBeUndefined()
  })
})
