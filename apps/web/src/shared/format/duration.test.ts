import { describe, expect, test } from 'bun:test'
import { formatHoursFromMinutes } from './duration.ts'

describe('formatHoursFromMinutes：分鐘 → 「H.M」小時數字字串，不含單位', () => {
  test('整數小時', () => {
    expect(formatHoursFromMinutes(0)).toBe('0.0')
    expect(formatHoursFromMinutes(60)).toBe('1.0')
    expect(formatHoursFromMinutes(480)).toBe('8.0')
  })

  test('半小時、整六分鐘的倍數精確顯示', () => {
    expect(formatHoursFromMinutes(90)).toBe('1.5')
    expect(formatHoursFromMinutes(510)).toBe('8.5')
  })

  test('四捨五入到最接近的 6 分鐘（UI 12 範例：170.1 小時 = 10206 分鐘）', () => {
    expect(formatHoursFromMinutes(10206)).toBe('170.1')
  })

  test('不足 6 分鐘的餘數四捨五入', () => {
    expect(formatHoursFromMinutes(511)).toBe('8.5') // 511 分 → 最接近 510 分（8.5 小時）
    expect(formatHoursFromMinutes(513)).toBe('8.6') // 513 分 → 最接近 516 分（8.6 小時）
  })
})
