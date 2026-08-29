import { describe, expect, test } from 'bun:test'
import { BusinessRuleError, PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import {
  emptyRevokeFormErrors,
  revokeFormItemErrorProp,
  toGeneralFailureMessage,
  toRevokeFormErrors,
} from './dashboard-main.errors.view.ts'

const $t = (key: string): string => key

const buildError = (field: string | undefined, msg = 'error'): EnvelopeError => ({
  code: 'attendance.records.errors.x',
  msg,
  data: field === undefined ? {} : { field },
})

describe('toRevokeFormErrors', () => {
  test('field 為 reason 的錯誤進 reasonMessage', () => {
    const result = toRevokeFormErrors([buildError('reason', '原因太短')])
    expect(result.reasonMessage).toBe('原因太短')
    expect(result.generalMessages).toEqual([])
  })

  test('沒有 field 或 field 不是 reason 的錯誤進 generalMessages（目前 revoke 端點的實際情況）', () => {
    const result = toRevokeFormErrors([buildError(undefined, '已經撤銷過了'), buildError('recordId', '找不到這筆記錄')])
    expect(result.reasonMessage).toBeNull()
    expect(result.generalMessages).toEqual(['已經撤銷過了', '找不到這筆記錄'])
  })

  test('只取第一則 reason 錯誤，其餘落進 generalMessages', () => {
    const result = toRevokeFormErrors([buildError('reason', 'A'), buildError('reason', 'B')])
    expect(result.reasonMessage).toBe('A')
    expect(result.generalMessages).toEqual(['B'])
  })
})

describe('revokeFormItemErrorProp', () => {
  test('沒有錯誤時回空物件，不是 { error: undefined }', () => {
    const prop = revokeFormItemErrorProp(emptyRevokeFormErrors())
    expect(prop).toEqual({})
    expect('error' in prop).toBe(false)
  })

  test('有錯誤時回帶 error 鍵的物件', () => {
    const errors = toRevokeFormErrors([buildError('reason', '原因太短')])
    expect(revokeFormItemErrorProp(errors)).toEqual({ error: '原因太短' })
  })
})

describe('toGeneralFailureMessage', () => {
  test('無權限顯示無權限文案', () => {
    expect(toGeneralFailureMessage(new PermissionDeniedError('無權限'), $t)).toBe('error.no-permission')
  })

  test('業務錯誤顯示後端回來的第一則 msg', () => {
    const error = new BusinessRuleError('boom', [buildError(undefined, '已經有一筆有效的上班卡')])
    expect(toGeneralFailureMessage(error, $t)).toBe('已經有一筆有效的上班卡')
  })

  test('其餘一律系統錯誤文案', () => {
    expect(toGeneralFailureMessage(new Error('network down'), $t)).toBe('error.system')
  })
})
