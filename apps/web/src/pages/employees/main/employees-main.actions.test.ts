import { describe, expect, test } from 'bun:test'
import { canCreateEmployee } from './employees-main.actions.ts'

describe('canCreateEmployee', () => {
  test('有 employees.onboarding.create 權限才能看到新增按鈕', () => {
    expect(canCreateEmployee((code) => code === 'employees.onboarding.create')).toBe(true)
  })

  test('沒有該權限就不顯示', () => {
    expect(canCreateEmployee(() => false)).toBe(false)
  })
})
