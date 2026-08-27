import { describe, expect, test } from 'bun:test'
import { toLoginPayload } from './sessions-login.payload.ts'

describe('登入 payload 的組裝', () => {
  test('公司代號與帳號去掉前後空白', () => {
    const payload = toLoginPayload('  A001 ', ' alice ', 'secret')
    expect(payload.companyCode).toBe('A001')
    expect(payload.username).toBe('alice')
  })

  test('密碼原樣送出：空白是合法的密碼字元，擅自去掉會讓使用者永遠登不進去', () => {
    expect(toLoginPayload('A001', 'alice', '  pa ss  ').password).toBe('  pa ss  ')
  })
})
