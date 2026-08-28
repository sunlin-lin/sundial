import { describe, expect, test } from 'bun:test'
import { todayInTaipei } from './business-clock.ts'
import { formatDate } from './business-date.ts'

describe('今天（台北）', () => {
  test('輸出是後端 date 欄位的格式，可以直接送出也可以直接顯示', () => {
    // 不斷言「今天是幾號」：那會讓這支測試在每天午夜與每個 CI 節點的時區上表現不同
    //（§8.3.5 的同一條理由，對純函式測試同樣成立）。能斷言的是格式，而格式正是這支函式的規格。
    expect(todayInTaipei()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('輸出直接餵給日期格式化函式時原樣通過，不會被當成讀不懂的字串', () => {
    const today = todayInTaipei()
    expect(formatDate(today)).toBe(today)
  })

  test('不帶任何時區標記——帶偏移的字串一律不得上畫面（§9.2）', () => {
    const today = todayInTaipei()
    expect(today).not.toContain('T')
    expect(today).not.toContain('Z')
    expect(today).not.toContain('+')
  })
})
