import { describe, expect, test } from 'bun:test'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import {
  ATTENDANCE_TYPE_CLOCK_IN,
  ATTENDANCE_TYPE_CLOCK_OUT,
  clockTimeDisplay,
  deriveTodayStatus,
  emptyTodayPunches,
  todayStatusLabel,
  workedHoursDisplay,
  workedMinutes,
  type AttendanceRecordDetail,
} from './dashboard-main.view.ts'

const $t = (key: string): string => key

/** 只填測試用得到的欄位；其餘欄位對狀態推導與時刻／工時計算沒有影響。 */
const buildRecord = (clockedAt: string): AttendanceRecordDetail => ({
  id: 'record-1',
  employeeId: 'employee-1',
  employmentId: 'employment-1',
  workDate: '2026-08-28',
  attendanceTypeCode: ATTENDANCE_TYPE_CLOCK_IN,
  sourceTypeCode: 1,
  clockedAt,
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  address: null,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  createdAt: clockedAt,
  updatedAt: clockedAt,
})

describe('deriveTodayStatus', () => {
  test('都沒有卡：尚未上班', () => {
    expect(deriveTodayStatus(emptyTodayPunches())).toBe('not-started')
  })

  test('只有上班卡：上班中', () => {
    expect(deriveTodayStatus({ clockIn: buildRecord('2026-08-28 09:00:00'), clockOut: null })).toBe('clocked-in')
  })

  test('上班卡＋下班卡都有：已下班（優先判定，即使兩者都存在）', () => {
    expect(
      deriveTodayStatus({
        clockIn: buildRecord('2026-08-28 09:00:00'),
        clockOut: buildRecord('2026-08-28 18:00:00'),
      }),
    ).toBe('clocked-out')
  })
})

describe('todayStatusLabel', () => {
  test('三種狀態各自對到不同的 key', () => {
    expect(todayStatusLabel('not-started', $t)).toBe('dashboard.attendance.status.not-started')
    expect(todayStatusLabel('clocked-in', $t)).toBe('dashboard.attendance.status.clocked-in')
    expect(todayStatusLabel('clocked-out', $t)).toBe('dashboard.attendance.status.clocked-out')
  })
})

describe('clockTimeDisplay', () => {
  test('沒有記錄時顯示 EMPTY_DISPLAY', () => {
    expect(clockTimeDisplay(null)).toBe(EMPTY_DISPLAY)
  })

  test('有記錄時只顯示時:分，不顯示秒（座標與其他欄位都不上畫面）', () => {
    expect(clockTimeDisplay(buildRecord('2026-08-28 09:03:45'))).toBe('09:03')
  })
})

describe('workedMinutes', () => {
  test('缺任一張卡回 null', () => {
    expect(workedMinutes({ clockIn: buildRecord('2026-08-28 09:00:00'), clockOut: null })).toBeNull()
    expect(workedMinutes(emptyTodayPunches())).toBeNull()
  })

  test('同一天上下班：直接相減', () => {
    const punches = { clockIn: buildRecord('2026-08-28 09:00:00'), clockOut: buildRecord('2026-08-28 18:00:00') }
    expect(workedMinutes(punches)).toBe(9 * 60)
  })

  test('跨日（下班卡配對到前一天的上班卡）：加一天粗略處理，不是負數', () => {
    const punches = { clockIn: buildRecord('2026-08-28 22:00:00'), clockOut: buildRecord('2026-08-28 06:00:00') }
    expect(workedMinutes(punches)).toBe(8 * 60)
  })
})

describe('workedHoursDisplay', () => {
  test('null 顯示 EMPTY_DISPLAY', () => {
    expect(workedHoursDisplay(null, $t)).toBe(EMPTY_DISPLAY)
  })

  test('整數小時', () => {
    expect(workedHoursDisplay(8 * 60, $t)).toBe('8.0 dashboard.attendance.unit.hours')
  })

  test('四捨五入到小數一位（以 6 分鐘為一格）', () => {
    expect(workedHoursDisplay(8 * 60 + 30, $t)).toBe('8.5 dashboard.attendance.unit.hours')
  })
})

describe('打卡類型常數', () => {
  test('對齊後端 db/schema/attendance-records.ts 的 AttendanceTypeCode', () => {
    expect(ATTENDANCE_TYPE_CLOCK_IN).toBe(1)
    expect(ATTENDANCE_TYPE_CLOCK_OUT).toBe(2)
  })
})
