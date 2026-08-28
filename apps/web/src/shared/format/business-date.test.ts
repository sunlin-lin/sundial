import { describe, expect, test } from 'bun:test'
import { formatDate, formatDateTime, formatYearMonth } from './business-date.ts'
import { EMPTY_DISPLAY } from './empty-display.ts'

describe('日期顯示', () => {
  test('date 與 datetime 都接受，一律只取日期的部分', () => {
    expect(formatDate('2026-08-26')).toBe('2026-08-26')
    expect(formatDate('2026-08-26 09:30:45')).toBe('2026-08-26')
  })

  test('一律西元，不轉民國（計畫 §5.1）', () => {
    // 判斷錯紀年的代價是差 1911 年，看起來像資料壞掉。這一條沒有開關、沒有參數。
    expect(formatDate('2026-08-26')).toBe('2026-08-26')
    expect(formatDate('2026-08-26')).not.toBe('115-08-26')
  })
})

describe('日期時間顯示', () => {
  test('顯示到分，不顯示秒（§9.2 的 YYYY-MM-DD HH:mm）', () => {
    expect(formatDateTime('2026-08-26 09:30:45')).toBe('2026-08-26 09:30')
    expect(formatDateTime('2026-08-26 00:00:00')).toBe('2026-08-26 00:00')
  })

  test('輸入只有日期時不補 00:00：那會宣稱這件事發生在午夜', () => {
    expect(formatDateTime('2026-08-26')).toBe('2026-08-26')
  })
})

describe('年月顯示', () => {
  test('取前七個字元', () => {
    expect(formatYearMonth('2026-08-26')).toBe('2026-08')
    expect(formatYearMonth('2026-08-26 09:30:45')).toBe('2026-08')
  })
})

describe('沒有值', () => {
  test('null、undefined、空字串、只有空白，三支函式一律回空值符號', () => {
    for (const format of [formatDate, formatDateTime, formatYearMonth]) {
      expect(format(null)).toBe(EMPTY_DISPLAY)
      expect(format(undefined)).toBe(EMPTY_DISPLAY)
      expect(format('')).toBe(EMPTY_DISPLAY)
      expect(format('  ')).toBe(EMPTY_DISPLAY)
    }
  })
})

describe('帶時區標記的字串一律不上畫面（§9.2，零例外）', () => {
  test('rqTS / rspTS / exp 的三種寫法都被擋在畫面之外', () => {
    // 這三個只供 log 與除錯。危險之處在於它們的前 10 個字元是一個合法的日期，
    // 裁切之後看起來完全正常，而 rspTS 是「回應產生的時刻」，跟業務事件發生的時刻是兩回事。
    expect(formatDateTime('2026-04-14T14:30:00+08:00')).toBe(EMPTY_DISPLAY)
    expect(formatDateTime('2026-08-19T18:28:28Z')).toBe(EMPTY_DISPLAY)
    expect(formatDateTime('2026-04-14 14:30:00+08:00')).toBe(EMPTY_DISPLAY)
    expect(formatDate('2026-04-14T14:30:00+08:00')).toBe(EMPTY_DISPLAY)
    expect(formatYearMonth('2026-04-14T14:30:00+08:00')).toBe(EMPTY_DISPLAY)
  })

  test('沒有這道閘門的話，裁切會產出一個看起來完全正常的日期', () => {
    // 這一條斷言的是「為什麼要特別擋」：純裁切的結果與合法輸入無法分辨。
    expect('2026-04-14T14:30:00+08:00'.slice(0, 10)).toBe('2026-04-14')
  })
})

describe('讀不懂的字串原樣輸出', () => {
  test('後端改了格式時，畫面上看得見那個改動', () => {
    // 回空值符號會把「格式變了」偽裝成「這一筆沒有資料」，而空白是合法狀態，於是沒有人會查。
    expect(formatDate('2026/08/26')).toBe('2026/08/26')
    expect(formatDateTime('2026-08-26 09:30')).toBe('2026-08-26 09:30') // 省略秒：不是 §6.1 的兩種格式
    expect(formatDate('yesterday')).toBe('yesterday')
  })
})
