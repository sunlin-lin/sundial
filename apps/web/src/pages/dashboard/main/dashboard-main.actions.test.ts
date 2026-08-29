import { describe, expect, test } from 'bun:test'
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'
import {
  canClockIn,
  canClockOut,
  canRevokeClockIn,
  canRevokeClockOut,
  canSubmitRevokeForm,
  shouldDisableClockInRevokeForClockOut,
} from './dashboard-main.actions.ts'

const grantedOnly =
  (...codes: readonly PermissionCode[]) =>
  (code: PermissionCode): boolean =>
    codes.includes(code)

const canAll: (code: PermissionCode) => boolean = grantedOnly('attendance.records.create', 'attendance.records.revoke')
const canNone: (code: PermissionCode) => boolean = grantedOnly()

describe('canClockIn／canClockOut：依狀態只顯示下一個有效動作', () => {
  test('尚未上班時可以上班打卡，不能下班打卡', () => {
    expect(canClockIn({ status: 'not-started', isSubmitting: false, can: canAll })).toBe(true)
    expect(canClockOut({ status: 'not-started', isSubmitting: false, can: canAll })).toBe(false)
  })

  test('上班中時可以下班打卡，不能再上班打卡', () => {
    expect(canClockIn({ status: 'clocked-in', isSubmitting: false, can: canAll })).toBe(false)
    expect(canClockOut({ status: 'clocked-in', isSubmitting: false, can: canAll })).toBe(true)
  })

  test('已下班時兩者都不能再按——今日打卡完成', () => {
    expect(canClockIn({ status: 'clocked-out', isSubmitting: false, can: canAll })).toBe(false)
    expect(canClockOut({ status: 'clocked-out', isSubmitting: false, can: canAll })).toBe(false)
  })

  test('送出中防重複點擊', () => {
    expect(canClockIn({ status: 'not-started', isSubmitting: true, can: canAll })).toBe(false)
    expect(canClockOut({ status: 'clocked-in', isSubmitting: true, can: canAll })).toBe(false)
  })

  test('沒有 attendance.records.create 權限一律不能按', () => {
    expect(canClockIn({ status: 'not-started', isSubmitting: false, can: canNone })).toBe(false)
    expect(canClockOut({ status: 'clocked-in', isSubmitting: false, can: canNone })).toBe(false)
  })
})

describe('canRevokeClockOut：下班卡永遠可以先撤銷', () => {
  const base = { allowEmployeeCancellation: true, isSubmitting: false, can: canAll }

  test('已下班時可撤銷下班卡', () => {
    expect(canRevokeClockOut({ ...base, status: 'clocked-out' })).toBe(true)
  })

  test('尚未有下班卡（尚未上班／上班中）不能撤銷下班卡', () => {
    expect(canRevokeClockOut({ ...base, status: 'not-started' })).toBe(false)
    expect(canRevokeClockOut({ ...base, status: 'clocked-in' })).toBe(false)
  })

  test('公司設定不允許員工自行撤銷時，即使狀態允許也不能按', () => {
    expect(canRevokeClockOut({ ...base, status: 'clocked-out', allowEmployeeCancellation: false })).toBe(false)
  })

  test('沒有 attendance.records.revoke 權限不能按', () => {
    expect(canRevokeClockOut({ ...base, status: 'clocked-out', can: canNone })).toBe(false)
  })
})

describe('canRevokeClockIn：已下班時不能直接撤銷上班卡，須先撤銷下班卡', () => {
  const base = { allowEmployeeCancellation: true, isSubmitting: false, can: canAll }

  test('上班中（還沒有下班卡）可以撤銷上班卡', () => {
    expect(canRevokeClockIn({ ...base, status: 'clocked-in' })).toBe(true)
  })

  test('已下班時不能直接撤銷上班卡——字典規則：需先撤銷下班卡', () => {
    expect(canRevokeClockIn({ ...base, status: 'clocked-out' })).toBe(false)
  })

  test('尚未上班（沒有上班卡）不能撤銷', () => {
    expect(canRevokeClockIn({ ...base, status: 'not-started' })).toBe(false)
  })
})

describe('shouldDisableClockInRevokeForClockOut：對應上一組測試的停用＋原因提示', () => {
  test('只有已下班狀態要停用', () => {
    expect(shouldDisableClockInRevokeForClockOut('clocked-out')).toBe(true)
    expect(shouldDisableClockInRevokeForClockOut('clocked-in')).toBe(false)
    expect(shouldDisableClockInRevokeForClockOut('not-started')).toBe(false)
  })
})

describe('canSubmitRevokeForm：撤銷原因必填', () => {
  test('有填原因可送出', () => {
    expect(canSubmitRevokeForm({ isSubmitting: false, reason: '打錯卡' })).toBe(true)
  })

  test('只有空白字元視為未填', () => {
    expect(canSubmitRevokeForm({ isSubmitting: false, reason: '   ' })).toBe(false)
    expect(canSubmitRevokeForm({ isSubmitting: false, reason: '' })).toBe(false)
  })

  test('送出中不可再按', () => {
    expect(canSubmitRevokeForm({ isSubmitting: true, reason: '打錯卡' })).toBe(false)
  })

  test('超過後端 Reason 欄位上限（500 字）不可送出', () => {
    expect(canSubmitRevokeForm({ isSubmitting: false, reason: 'a'.repeat(501) })).toBe(false)
    expect(canSubmitRevokeForm({ isSubmitting: false, reason: 'a'.repeat(500) })).toBe(true)
  })
})
