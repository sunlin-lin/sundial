import { describe, expect, test } from 'bun:test'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import {
  minutesToHoursDisplay,
  previewRequiredWorkMinutes,
  requiredWorkHoursDisplay,
  toSafeMinutes,
} from './shifts-main.duration.view.ts'

const echoTranslate: TranslateMessage = (key) => key

describe('安全整數轉換（不呼叫 Number(／parseInt(）', () => {
  test('已經是 number 時原樣回傳', () => {
    expect(toSafeMinutes(420)).toBe(420)
  })

  test('數字字串逐位累加成整數', () => {
    expect(toSafeMinutes('420')).toBe(420)
  })

  test('負數字串：符號另外處理，量值一樣逐位累加', () => {
    expect(toSafeMinutes('-30')).toBe(-30)
  })

  test('0 不是負數也不是空值', () => {
    expect(toSafeMinutes('0')).toBe(0)
  })
})

describe('分鐘 → 小時（一位小數）', () => {
  test('沒有值顯示「沒有值」', () => {
    expect(minutesToHoursDisplay(null, echoTranslate)).toBe('—')
  })

  test('420 分鐘＝ 7.0 小時（計畫 04 驗收案例：22:00–06:00 跨日班含 02:00–03:00 無薪休息）', () => {
    expect(minutesToHoursDisplay(420, echoTranslate)).toBe('7.0 shifts-main.unit.hours')
  })

  test('整數小時之外的分鐘四捨五入到最接近的一位小數', () => {
    // 100 分鐘 = 1 小時又 40 分 → 1.666...7 小時，四捨五入到十分位是 1.7
    expect(minutesToHoursDisplay(100, echoTranslate)).toBe('1.7 shifts-main.unit.hours')
  })

  test('負數同樣呈現得出來（結構性錯誤還沒送出前的即時預覽，見必做事項 1）', () => {
    expect(minutesToHoursDisplay(-30, echoTranslate)).toBe('-0.5 shifts-main.unit.hours')
  })

  test('0 分鐘是 0.0 小時，不是「沒有值」', () => {
    expect(minutesToHoursDisplay(0, echoTranslate)).toBe('0.0 shifts-main.unit.hours')
  })
})

describe('清單欄：API 的 requiredWorkMinutes（string | number）直接轉顯示字串', () => {
  test('字串形式', () => {
    expect(requiredWorkHoursDisplay('420', echoTranslate)).toBe('7.0 shifts-main.unit.hours')
  })

  test('數字形式', () => {
    expect(requiredWorkHoursDisplay(420, echoTranslate)).toBe('7.0 shifts-main.unit.hours')
  })
})

describe('表單編輯時的即時預覽（previewRequiredWorkMinutes）', () => {
  test('計畫 04 驗收案例：22:00–06:00 跨日班，含 02:00–03:00 無薪休息 → 420 分鐘', () => {
    const periods = [{ startTime: '22:00', endTime: '06:00', endDayOffset: 1 as const }]
    const breaks = [
      { startTime: '02:00', endTime: '03:00', startDayOffset: 1 as const, endDayOffset: 1 as const, isPaid: false },
    ]
    expect(previewRequiredWorkMinutes(periods, breaks)).toBe(420)
  })

  test('中空班：09:00–12:00 ＋ 14:00–18:00，空檔不計入應工作分鐘（總計 7 小時＝420 分）', () => {
    const periods = [
      { startTime: '09:00', endTime: '12:00', endDayOffset: 0 as const },
      { startTime: '14:00', endTime: '18:00', endDayOffset: 0 as const },
    ]
    expect(previewRequiredWorkMinutes(periods, [])).toBe(420)
  })

  test('有薪休息不扣：休息 12:00–13:00 是有薪時，應工作分鐘不變', () => {
    const periods = [{ startTime: '09:00', endTime: '18:00', endDayOffset: 0 as const }]
    const breaks = [
      { startTime: '12:00', endTime: '13:00', startDayOffset: 0 as const, endDayOffset: 0 as const, isPaid: true },
    ]
    expect(previewRequiredWorkMinutes(periods, breaks)).toBe(540)
  })

  test('時間還沒填完整（使用者正在輸入）時回 null，不是誤導人的 0', () => {
    const periods = [{ startTime: '09:0', endTime: '', endDayOffset: 0 as const }]
    expect(previewRequiredWorkMinutes(periods, [])).toBeNull()
  })

  test('沒有任何時段時回 0（總和的單位元素），不是 null——由 `.actions.ts` 的必填檢查擋送出', () => {
    expect(previewRequiredWorkMinutes([], [])).toBe(0)
  })
})
