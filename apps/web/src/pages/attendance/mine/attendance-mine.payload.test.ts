import { describe, expect, test } from 'bun:test'
import {
  ATTENDANCE_MINE_PER_PAGE,
  ATTENDANCE_MINE_SORT,
  defaultAttendanceMineFilters,
  toAttendanceMineListQuery,
} from './attendance-mine.payload.ts'

describe('defaultAttendanceMineFilters：預設值', () => {
  test('年月是 YYYY-MM 格式（系統當月）', () => {
    expect(defaultAttendanceMineFilters().yearMonth).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('toAttendanceMineListQuery：查詢條件 → 送出 payload', () => {
  test('不接受 departmentId／employeeId，一次拿完整月不分頁', () => {
    const query = toAttendanceMineListQuery({ yearMonth: '2026-08' })
    expect(query).toEqual({
      yearMonth: '2026-08',
      currentPage: 1,
      perPage: ATTENDANCE_MINE_PER_PAGE,
      sort: ATTENDANCE_MINE_SORT,
    })
    expect('departmentId' in query).toBe(false)
    expect('employeeId' in query).toBe(false)
  })

  test('perPage 上限 100 足夠一個月最多 31 列一次拿完', () => {
    expect(ATTENDANCE_MINE_PER_PAGE).toBeLessThanOrEqual(100)
    expect(ATTENDANCE_MINE_PER_PAGE).toBeGreaterThanOrEqual(31)
  })
})
