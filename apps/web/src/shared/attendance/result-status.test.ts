import { describe, expect, test } from 'bun:test'
import { attendanceResultStatusPresentations } from './result-status.ts'

describe('attendanceResultStatusPresentations：狀態是陣列，不是單一互斥值（UI 09／12）', () => {
  test('單一旗標', () => {
    expect(attendanceResultStatusPresentations(['NO_SCHEDULE'])).toEqual([
      { labelKey: 'attendance.result-status.no-schedule', tone: 'info' },
    ])
  })

  test('同一天可以同時出現多個旗標，順序與輸入相同', () => {
    const result = attendanceResultStatusPresentations(['LATE', 'EARLY_LEAVE'])
    expect(result).toEqual([
      { labelKey: 'attendance.result-status.late', tone: 'warning' },
      { labelKey: 'attendance.result-status.early-leave', tone: 'warning' },
    ])
  })

  test('五種旗標逐一核對呈現', () => {
    expect(attendanceResultStatusPresentations(['ABSENT'])[0]).toEqual({
      labelKey: 'attendance.result-status.absent',
      tone: 'danger',
    })
    expect(attendanceResultStatusPresentations(['ON_LEAVE'])[0]).toEqual({
      labelKey: 'attendance.result-status.on-leave',
      tone: 'info',
    })
  })

  test('空陣列回空陣列', () => {
    expect(attendanceResultStatusPresentations([])).toEqual([])
  })
})
