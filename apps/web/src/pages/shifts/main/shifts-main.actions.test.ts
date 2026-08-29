import { describe, expect, test } from 'bun:test'
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'
import {
  canCopyShift,
  canCreateShift,
  canDeleteShift,
  canEditShift,
  canSubmitCopyForm,
  canSubmitShiftForm,
  canToggleShiftActive,
} from './shifts-main.actions.ts'

const grantedOnly =
  (...codes: readonly PermissionCode[]) =>
  (code: PermissionCode): boolean =>
    codes.includes(code)

describe('沒有權限時看不到對應的動作', () => {
  test('沒有 shifts.main.create 看不到新增鈕', () => {
    expect(canCreateShift(grantedOnly())).toBe(false)
    expect(canCreateShift(grantedOnly('shifts.main.create'))).toBe(true)
  })

  test('沒有 shifts.main.update 看不到編輯鈕與啟用停用鈕——兩者共用 update（計畫 §6）', () => {
    const can = grantedOnly()
    expect(canEditShift(can)).toBe(false)
    expect(canToggleShiftActive(can)).toBe(false)
  })

  test('有 shifts.main.update 兩者都看得到', () => {
    const can = grantedOnly('shifts.main.update')
    expect(canEditShift(can)).toBe(true)
    expect(canToggleShiftActive(can)).toBe(true)
  })

  test('複製與刪除各自獨立判斷', () => {
    expect(canCopyShift(grantedOnly('shifts.main.copy'))).toBe(true)
    expect(canCopyShift(grantedOnly('shifts.main.delete'))).toBe(false)
    expect(canDeleteShift(grantedOnly('shifts.main.delete'))).toBe(true)
    expect(canDeleteShift(grantedOnly('shifts.main.copy'))).toBe(false)
  })
})

describe('建立／修改表單送出鈕', () => {
  const validInput = {
    isSubmitting: false,
    isLoadingDetail: false,
    code: 'DAY',
    name: '日班',
    description: '09:00–18:00',
    workPeriodCount: 1,
  }

  test('全部填妥時可送出', () => {
    expect(canSubmitShiftForm(validInput)).toBe(true)
  })

  test('送出中不可再按（§6.2 防重複點擊）', () => {
    expect(canSubmitShiftForm({ ...validInput, isSubmitting: true })).toBe(false)
  })

  test('明細還在載入中（修改模式）不可送出——那時表單值還是舊的空殼', () => {
    expect(canSubmitShiftForm({ ...validInput, isLoadingDetail: true })).toBe(false)
  })

  test('代碼／名稱／說明只有空白字元視為未填', () => {
    expect(canSubmitShiftForm({ ...validInput, code: '  ' })).toBe(false)
    expect(canSubmitShiftForm({ ...validInput, name: '' })).toBe(false)
    expect(canSubmitShiftForm({ ...validInput, description: '   ' })).toBe(false)
  })

  test('一段工作時段都沒有時不可送出——不必等後端的 300 才知道要加時段', () => {
    expect(canSubmitShiftForm({ ...validInput, workPeriodCount: 0 })).toBe(false)
  })
})

describe('複製表單送出鈕', () => {
  const validInput = { isSubmitting: false, code: 'DAY-2', name: '日班（複製）', description: '說明重填' }

  test('三個欄位都填妥時可送出', () => {
    expect(canSubmitCopyForm(validInput)).toBe(true)
  })

  test('送出中不可再按', () => {
    expect(canSubmitCopyForm({ ...validInput, isSubmitting: true })).toBe(false)
  })

  test('說明留白不可送出——複製表單的說明刻意不帶入來源，必須由使用者重填', () => {
    expect(canSubmitCopyForm({ ...validInput, description: '' })).toBe(false)
  })
})
