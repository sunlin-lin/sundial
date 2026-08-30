import { describe, expect, test } from 'bun:test'
import {
  ATTENDANCE_ALL_PER_PAGE,
  ATTENDANCE_ALL_SORT,
  defaultAttendanceAllFilters,
  hasActiveAttendanceAllFilters,
  toAttendanceAllListQuery,
} from './attendance-all.payload.ts'

describe('defaultAttendanceAllFilters：預設值', () => {
  test('部門與人員預設不篩選，年月是 YYYY-MM 格式', () => {
    const filters = defaultAttendanceAllFilters()
    expect(filters.departmentId).toBeNull()
    expect(filters.employeeId).toBeNull()
    expect(filters.yearMonth).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('toAttendanceAllListQuery：查詢條件 → 送出 payload', () => {
  test('部門與人員未選時整把鍵都不出現，不是設成 undefined', () => {
    const query = toAttendanceAllListQuery({ yearMonth: '2026-08', departmentId: null, employeeId: null }, 1)
    expect('departmentId' in query).toBe(false)
    expect('employeeId' in query).toBe(false)
    expect(query.yearMonth).toBe('2026-08')
    expect(query.currentPage).toBe(1)
    expect(query.perPage).toBe(ATTENDANCE_ALL_PER_PAGE)
    expect(query.sort).toEqual(ATTENDANCE_ALL_SORT)
  })

  test('部門與人員都選時展開進 query', () => {
    const query = toAttendanceAllListQuery(
      { yearMonth: '2026-08', departmentId: 'dept-1', employeeId: 'employee-1' },
      2,
    )
    expect(query.departmentId).toBe('dept-1')
    expect(query.employeeId).toBe('employee-1')
    expect(query.currentPage).toBe(2)
  })
})

describe('hasActiveAttendanceAllFilters：空結果要分「本來就沒資料」與「篩選後無結果」', () => {
  test('沒有套用部門或人員篩選', () => {
    expect(hasActiveAttendanceAllFilters({ yearMonth: '2026-08', departmentId: null, employeeId: null })).toBe(false)
  })

  test('套用部門或人員任一篩選', () => {
    expect(hasActiveAttendanceAllFilters({ yearMonth: '2026-08', departmentId: 'dept-1', employeeId: null })).toBe(true)
    expect(hasActiveAttendanceAllFilters({ yearMonth: '2026-08', departmentId: null, employeeId: 'employee-1' })).toBe(
      true,
    )
  })
})
