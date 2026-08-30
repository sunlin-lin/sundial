import { describe, expect, test } from 'bun:test'
import { summarizeAttendanceMineMonth, toAttendanceMineStatsDisplay } from './attendance-mine.stats.view.ts'
import type { AttendanceMineListItem } from './attendance-mine.view.ts'

const $t = (key: string): string => key

const buildItem = (overrides: Partial<AttendanceMineListItem>): AttendanceMineListItem => ({
  id: 'result-1',
  workDate: '2026-08-26',
  clockInAt: '2026-08-26 09:03:00',
  clockInAddress: null,
  clockOutAt: '2026-08-26 18:05:00',
  clockOutAddress: null,
  workedMinutes: 480,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  absenceMinutes: 0,
  sourceTypeCode: 1,
  statuses: ['NO_SCHEDULE'],
  ...overrides,
})

describe('summarizeAttendanceMineMonth：月度彙總逐格測試（UI 12「當月出勤統計」）', () => {
  test('空陣列：五個數字都是 0', () => {
    expect(summarizeAttendanceMineMonth([])).toEqual({
      attendanceDays: 0,
      totalWorkedMinutes: 0,
      lateDays: 0,
      earlyLeaveDays: 0,
      absentDays: 0,
    })
  })

  test('出勤天數＝列數，一天一列只計一次', () => {
    const items = [buildItem({ id: 'a', workDate: '2026-08-01' }), buildItem({ id: 'b', workDate: '2026-08-02' })]
    expect(summarizeAttendanceMineMonth(items).attendanceDays).toBe(2)
  })

  test('總工時是 workedMinutes 加總，尚未換算成小時', () => {
    const items = [
      buildItem({ workedMinutes: 480 }),
      buildItem({ workedMinutes: 480 }),
      buildItem({ workedMinutes: '480' }),
    ]
    expect(summarizeAttendanceMineMonth(items).totalWorkedMinutes).toBe(1440)
  })

  test('遲到／早退天數各自獨立計算：同一天同時遲到與早退，兩項各計一天（UI 12 明文）', () => {
    const items = [buildItem({ lateMinutes: 10, earlyLeaveMinutes: 5 })]
    const summary = summarizeAttendanceMineMonth(items)
    expect(summary.lateDays).toBe(1)
    expect(summary.earlyLeaveDays).toBe(1)
  })

  test('遲到／早退／缺勤為 0 分鐘的列不計入天數', () => {
    const items = [buildItem({ lateMinutes: 0, earlyLeaveMinutes: 0, absenceMinutes: 0 })]
    const summary = summarizeAttendanceMineMonth(items)
    expect(summary.lateDays).toBe(0)
    expect(summary.earlyLeaveDays).toBe(0)
    expect(summary.absentDays).toBe(0)
  })

  test('缺勤天數＝absenceMinutes > 0 的工作日數', () => {
    const items = [buildItem({ absenceMinutes: 480 }), buildItem({ absenceMinutes: 0 })]
    expect(summarizeAttendanceMineMonth(items).absentDays).toBe(1)
  })

  test('workedMinutes 等欄位是 string 時也能正確加總（後端形狀缺口，見 shared/format/duration.ts 檔頭）', () => {
    const items = [buildItem({ lateMinutes: '15' }), buildItem({ lateMinutes: 0 })]
    expect(summarizeAttendanceMineMonth(items).lateDays).toBe(1)
  })
})

describe('toAttendanceMineStatsDisplay：UI 12 範例「出勤 22 天／總工時 170.1 小時／遲到 1 天／早退 1 天／缺勤 0 天」', () => {
  test('五張卡片依固定順序輸出，數字與單位都正確', () => {
    const cards = toAttendanceMineStatsDisplay(
      { attendanceDays: 22, totalWorkedMinutes: 10206, lateDays: 1, earlyLeaveDays: 1, absentDays: 0 },
      $t,
    )
    expect(cards).toEqual([
      { labelKey: 'attendance-mine.stats.attendance-days', valueDisplay: '22 attendance.unit.days' },
      { labelKey: 'attendance-mine.stats.total-worked-hours', valueDisplay: '170.1 attendance.unit.hours' },
      { labelKey: 'attendance-mine.stats.late-days', valueDisplay: '1 attendance.unit.days' },
      { labelKey: 'attendance-mine.stats.early-leave-days', valueDisplay: '1 attendance.unit.days' },
      { labelKey: 'attendance-mine.stats.absent-days', valueDisplay: '0 attendance.unit.days' },
    ])
  })
})
