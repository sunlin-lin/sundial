import { describe, expect, test } from 'bun:test'
import { activeOnly, employmentTypeLabel, withholdingMethodLabel } from './employees-onboarding.view.ts'

describe('activeOnly', () => {
  test('過濾掉停用的項目', () => {
    const items = [
      { id: '1', status: 'ACTIVE' as const },
      { id: '2', status: 'INACTIVE' as const },
      { id: '3', status: 'ACTIVE' as const },
    ]

    expect(activeOnly(items).map((item) => item.id)).toEqual(['1', '3'])
  })

  test('全部啟用時原樣回傳', () => {
    const items = [{ id: '1', status: 'ACTIVE' as const }]

    expect(activeOnly(items)).toEqual(items)
  })
})

describe('employmentTypeLabel', () => {
  test('每個代碼都對到一個 key', () => {
    expect(employmentTypeLabel(1, (key) => key)).toBe('employees-onboarding.employment-type.1')
    expect(employmentTypeLabel(8, (key) => key)).toBe('employees-onboarding.employment-type.8')
  })
})

describe('withholdingMethodLabel', () => {
  test('薪資所得扣繳稅額表', () => {
    expect(withholdingMethodLabel(1, (key) => key)).toBe('employees-onboarding.withholding-method.1')
  })

  test('固定 5%', () => {
    expect(withholdingMethodLabel(2, (key) => key)).toBe('employees-onboarding.withholding-method.2')
  })
})
