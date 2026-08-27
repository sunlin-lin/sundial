import { describe, expect, test } from 'bun:test'
import { canSubmitLogin } from './sessions-login.actions.ts'
import { toLoginPayload } from './sessions-login.payload.ts'

describe('登入鈕的可用性', () => {
  test('三個欄位都填了且沒有請求在途中時可以送出', () => {
    expect(canSubmitLogin(toLoginPayload('A001', 'alice', 'secret'), false)).toBe(true)
  })

  test('送出中一律不可再按（防重複點擊）', () => {
    expect(canSubmitLogin(toLoginPayload('A001', 'alice', 'secret'), true)).toBe(false)
  })

  test.each([
    ['公司代號', '', 'alice', 'secret'],
    ['帳號', 'A001', '', 'secret'],
    ['密碼', 'A001', 'alice', ''],
  ])('缺少%s時不可送出', (_field, companyCode, username, password) => {
    expect(canSubmitLogin(toLoginPayload(companyCode, username, password), false)).toBe(false)
  })

  test('只填了空白的欄位等同沒填——去空白發生在組 payload 的時候', () => {
    expect(canSubmitLogin(toLoginPayload('   ', 'alice', 'secret'), false)).toBe(false)
  })
})
