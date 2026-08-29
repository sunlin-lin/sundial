import { describe, expect, test } from 'bun:test'
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'
import { canRevokeDailyRecord, canSubmitRevokeOtherForm } from './attendance-daily-records.actions.ts'

const grantedOnly =
  (...codes: readonly PermissionCode[]) =>
  (code: PermissionCode): boolean =>
    codes.includes(code)

const canRevokeOther: (code: PermissionCode) => boolean = grantedOnly('attendance.records.revoke-other')
const canNone: (code: PermissionCode) => boolean = grantedOnly()

describe('canRevokeDailyRecord：只有有效紀錄且具備 revoke-other 權限才顯示撤銷按鈕', () => {
  test('有效紀錄＋有權限：顯示', () => {
    expect(canRevokeDailyRecord({ isRevoked: false, can: canRevokeOther })).toBe(true)
  })

  test('已撤銷紀錄：即使有權限也不顯示——已經撤銷的紀錄不能再撤銷一次', () => {
    expect(canRevokeDailyRecord({ isRevoked: true, can: canRevokeOther })).toBe(false)
  })

  test('有效紀錄但沒有權限：不顯示', () => {
    expect(canRevokeDailyRecord({ isRevoked: false, can: canNone })).toBe(false)
  })

  test('已撤銷且沒有權限：不顯示', () => {
    expect(canRevokeDailyRecord({ isRevoked: true, can: canNone })).toBe(false)
  })
})

describe('canSubmitRevokeOtherForm：撤銷原因必填（同 dashboard-main 的 canSubmitRevokeForm）', () => {
  test('有填原因可送出', () => {
    expect(canSubmitRevokeOtherForm({ isSubmitting: false, reason: '員工要求撤銷' })).toBe(true)
  })

  test('只有空白字元視為未填', () => {
    expect(canSubmitRevokeOtherForm({ isSubmitting: false, reason: '   ' })).toBe(false)
    expect(canSubmitRevokeOtherForm({ isSubmitting: false, reason: '' })).toBe(false)
  })

  test('送出中不可再按', () => {
    expect(canSubmitRevokeOtherForm({ isSubmitting: true, reason: '員工要求撤銷' })).toBe(false)
  })

  test('超過後端 Reason 欄位上限（500 字）不可送出', () => {
    expect(canSubmitRevokeOtherForm({ isSubmitting: false, reason: 'a'.repeat(501) })).toBe(false)
    expect(canSubmitRevokeOtherForm({ isSubmitting: false, reason: 'a'.repeat(500) })).toBe(true)
  })
})
