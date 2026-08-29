import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { breakRangeDisplay, breaksSummaryDisplay, newBreak, paidLabel } from './shifts-main.breaks.view.ts'

const echoTranslate: TranslateMessage = (key) => key

describe('新增一段休息的預設值', () => {
  test('空白時間、當日、無薪', () => {
    expect(newBreak()).toEqual({
      startTime: '',
      endTime: '',
      startDayOffset: 0,
      endDayOffset: 0,
      isPaid: false,
    })
  })
})

describe('有薪／無薪文字', () => {
  test('有薪', () => {
    expect(paidLabel(true, echoTranslate)).toBe('shifts-main.break.paid')
  })

  test('無薪', () => {
    expect(paidLabel(false, echoTranslate)).toBe('shifts-main.break.unpaid')
  })
})

describe('一段休息的呈現', () => {
  test('跨日夜班的休息：起訖各自有日偏移，計畫 §4.2 的驗收案例（22:00–06:00 夜班休息 02:00–03:00）', () => {
    const display = breakRangeDisplay(
      { startTime: '02:00', endTime: '03:00', startDayOffset: 1, endDayOffset: 1, isPaid: false },
      echoTranslate,
    )
    expect(display).toBe(
      'shifts-main.day-offset.next 02:00–shifts-main.day-offset.next 03:00（shifts-main.break.unpaid）',
    )
  })

  test('當日休息，有薪', () => {
    const display = breakRangeDisplay(
      { startTime: '12:00', endTime: '13:00', startDayOffset: 0, endDayOffset: 0, isPaid: true },
      echoTranslate,
    )
    expect(display).toBe('12:00–13:00（shifts-main.break.paid）')
  })
})

describe('清單那一格：多段休息', () => {
  test('沒有休息時顯示「沒有值」，不是錯誤——一般班本來就可能沒有休息', () => {
    expect(breaksSummaryDisplay([], echoTranslate)).toBe('—')
  })

  test('多段各自一行', () => {
    const breaks = [
      { startTime: '10:00', endTime: '10:10', startDayOffset: 0, endDayOffset: 0, isPaid: true },
      { startTime: '12:00', endTime: '13:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
    ]
    expect(breaksSummaryDisplay(breaks, echoTranslate)).toBe(
      '10:00–10:10（shifts-main.break.paid）\n12:00–13:00（shifts-main.break.unpaid）',
    )
  })
})
