import { describe, expect, test } from 'bun:test'
import {
  activeOnly,
  employmentStatusLabel,
  employmentStatusTagType,
  employmentTypeLabel,
  formatOpenCode,
  isCurrentlyEffective,
  withholdingMethodLabel,
} from './employees-detail.view.ts'

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
