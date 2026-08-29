import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { dayOffsetPrefix, isNextDay, timeWithOffsetDisplay } from './shifts-main.day-offset.view.ts'

const echoTranslate: TranslateMessage = (key) => key

describe('是否隔日', () => {
  test('數字 1 是隔日', () => {
    expect(isNextDay(1)).toBe(true)
  })

  test('字串 "1" 同樣是隔日——後端的 t.Integer() 在 OpenAPI 上留下 string|number 的影子', () => {
    expect(isNextDay('1')).toBe(true)
  })

  test('0 不是隔日', () => {
    expect(isNextDay(0)).toBe(false)
    expect(isNextDay('0')).toBe(false)
  })
})

describe('隔日前綴', () => {
  test('隔日時帶前綴與一個空白', () => {
    expect(dayOffsetPrefix(1, echoTranslate)).toBe('shifts-main.day-offset.next ')
  })

  test('當日時是空字串', () => {
    expect(dayOffsetPrefix(0, echoTranslate)).toBe('')
  })
})

describe('時刻＋日偏移的呈現', () => {
  test('隔日：例如 22:00–06:00 夜班的結束時刻', () => {
    expect(timeWithOffsetDisplay('06:00', 1, echoTranslate)).toBe('shifts-main.day-offset.next 06:00')
  })

  test('當日：直接顯示時刻，不帶任何前綴', () => {
    expect(timeWithOffsetDisplay('22:00', 0, echoTranslate)).toBe('22:00')
  })
})
