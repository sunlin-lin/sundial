import { describe, expect, test } from 'bun:test'
import { emptyRevokeFormState, toRevokePayload } from './dashboard-main.payload.ts'

describe('emptyRevokeFormState', () => {
  test('初始值是空字串', () => {
    expect(emptyRevokeFormState()).toEqual({ reason: '' })
  })
})

describe('toRevokePayload', () => {
  test('原因會被 trim', () => {
    expect(toRevokePayload('record-1', { reason: '  打錯卡了  ' })).toEqual({
      recordId: 'record-1',
      reason: '打錯卡了',
    })
  })
})
