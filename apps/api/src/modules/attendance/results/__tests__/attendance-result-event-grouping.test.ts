/** 批次重算分組的單元測試（零 IO）。 */
import { describe, expect, test } from 'bun:test'
import { AttendanceTypeCode } from '../../../../db/schema/index.ts'
import {
  groupAttendanceEventsByEmployeeWorkDate,
  lookupAttendanceEvents,
} from '../domain/attendance-result-event-grouping.ts'

describe('groupAttendanceEventsByEmployeeWorkDate／lookupAttendanceEvents', () => {
  test('依 (employeeId, workDate) 分組，不同員工或不同工作日不會混在一起', () => {
    const rows = [
      {
        employeeId: 'emp-a',
        workDate: '2026-08-29',
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-29 09:00:00',
      },
      {
        employeeId: 'emp-a',
        workDate: '2026-08-29',
        attendanceTypeCode: AttendanceTypeCode.ClockOut,
        clockedAt: '2026-08-29 18:00:00',
      },
      {
        employeeId: 'emp-a',
        workDate: '2026-08-30',
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-30 09:00:00',
      },
      {
        employeeId: 'emp-b',
        workDate: '2026-08-29',
        attendanceTypeCode: AttendanceTypeCode.ClockIn,
        clockedAt: '2026-08-29 08:00:00',
      },
    ]
    const grouped = groupAttendanceEventsByEmployeeWorkDate(rows)

    expect(lookupAttendanceEvents(grouped, 'emp-a', '2026-08-29')).toHaveLength(2)
    expect(lookupAttendanceEvents(grouped, 'emp-a', '2026-08-30')).toHaveLength(1)
    expect(lookupAttendanceEvents(grouped, 'emp-b', '2026-08-29')).toHaveLength(1)
  })

  test('查無資料的組合回空陣列，不是 undefined', () => {
    const grouped = groupAttendanceEventsByEmployeeWorkDate([])
    expect(lookupAttendanceEvents(grouped, 'emp-x', '2026-01-01')).toEqual([])
  })
})
