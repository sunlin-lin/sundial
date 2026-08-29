import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import { newWorkPeriod, periodRangeDisplay, periodsSummaryDisplay } from './shifts-main.periods.view.ts'

const echoTranslate: TranslateMessage = (key) => key

describe('新增一段時段的預設值', () => {
  test('空白時間、當日結束——使用者從零開始填', () => {
    expect(newWorkPeriod()).toEqual({ startTime: '', endTime: '', endDayOffset: 0 })
  })
})

describe('一段時段的呈現', () => {
  test('一般班（當日）：22:00–06:00 這種寫法本身沒有 22:00 的隔日前綴', () => {
    expect(periodRangeDisplay({ startTime: '09:00', endTime: '18:00', endDayOffset: 0 }, echoTranslate)).toBe(
      '09:00–18:00',
    )
  })

  test('跨日班：結束時刻要標「隔日」，開始時刻不用（計畫 §4.2 的驗收案例）', () => {
    expect(periodRangeDisplay({ startTime: '22:00', endTime: '06:00', endDayOffset: 1 }, echoTranslate)).toBe(
      '22:00–shifts-main.day-offset.next 06:00',
    )
  })

  test('endDayOffset 是 API 的 string|number 也吃得下，不需要先轉型', () => {
    expect(periodRangeDisplay({ startTime: '22:00', endTime: '06:00', endDayOffset: '1' }, echoTranslate)).toBe(
      '22:00–shifts-main.day-offset.next 06:00',
    )
  })
})

describe('清單那一格：多段時段', () => {
  test('中空班：兩段各自一行，用換行分隔——空檔本身不需要特別標示', () => {
    const periods = [
      { startTime: '09:00', endTime: '12:00', endDayOffset: 0 },
      { startTime: '14:00', endTime: '18:00', endDayOffset: 0 },
    ]
    expect(periodsSummaryDisplay(periods, echoTranslate)).toBe('09:00–12:00\n14:00–18:00')
  })

  test('沒有任何時段顯示「沒有值」（防禦性：正常流程下至少會有一段）', () => {
    expect(periodsSummaryDisplay([], echoTranslate)).toBe('—')
  })
})
