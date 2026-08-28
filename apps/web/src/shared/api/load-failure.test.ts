import { describe, expect, test } from 'bun:test'
import {
  AuthRequiredError,
  BusinessRuleError,
  PermissionDeniedError,
  SystemFailureError,
} from './api-error.ts'
import { toLoadFailure } from './load-failure.ts'

describe('載入失敗的分流', () => {
  test('沒有權限時顯示後端回來的那句話，前端不另備文案', () => {
    const failure = toLoadFailure(new PermissionDeniedError('您沒有執行此操作的權限'))
    expect(failure).toEqual({ kind: 'permission-denied', message: '您沒有執行此操作的權限' })
  })

  test('沒有權限不算系統錯誤，因此走不到重試那條路徑', () => {
    expect(toLoadFailure(new PermissionDeniedError('無權限')).kind).not.toBe('system')
  })

  test.each([
    ['系統錯誤', new SystemFailureError('系統錯誤', '400', null)],
    ['業務錯誤', new BusinessRuleError('不允許', [])],
    ['沒有身分', new AuthRequiredError('請重新登入')],
    ['不是 Error 的東西', 'boom'],
  ])('%s 一律走可重試的系統錯誤畫面', (_label, error) => {
    expect(toLoadFailure(error).kind).toBe('system')
  })
})
