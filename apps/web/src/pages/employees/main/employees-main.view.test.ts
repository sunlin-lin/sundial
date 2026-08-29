import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { toDisplayRows, type EmployeeListItem } from './employees-main.view.ts'

/** 測試用最小翻譯函式：直接回傳 key，斷言時只需比對 key 是否正確。 */
const translate: TranslateMessage = (key) => key

const buildItem = (overrides: Partial<EmployeeListItem> = {}): EmployeeListItem => ({
  id: 'emp-1',
  employeeCode: 'A001',
  name: '王小明',
  gender: 'MALE',
  identityNumberMasked: '***456789',
  jobTitleName: '工程師',
  ...overrides,
})

describe('toDisplayRows', () => {
  test('女性顯示對應的性別 key', () => {
    const [row] = toDisplayRows([buildItem({ gender: 'FEMALE' })], translate)

    expect(row?.genderLabel).toBe('employees.gender.female')
  })

  test('男性顯示對應的性別 key', () => {
    const [row] = toDisplayRows([buildItem({ gender: 'MALE' })], translate)

    expect(row?.genderLabel).toBe('employees.gender.male')
  })

  test('沒有目前有效職稱時顯示空值符號，不是空字串或查詢失敗訊息', () => {
    const [row] = toDisplayRows([buildItem({ jobTitleName: null })], translate)

    expect(row?.jobTitleName).toBe('—')
  })

  test('保留員工編號與姓名原樣，不做任何轉換', () => {
    const [row] = toDisplayRows([buildItem({ employeeCode: 'B009', name: '陳小華' })], translate)

    expect(row?.employeeCode).toBe('B009')
    expect(row?.name).toBe('陳小華')
  })
})
