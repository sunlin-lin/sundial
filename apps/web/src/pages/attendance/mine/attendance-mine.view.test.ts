import { describe, expect, test } from 'bun:test'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import { toDisplayRows, type AttendanceMineListItem } from './attendance-mine.view.ts'

const $t = (key: string): string => key

describe('toDisplayRows：我的出勤列表呈現', () => {
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

  test('日期、上下班時刻只取時刻部分', () => {
    const [row] = toDisplayRows([buildItem({})], $t)
    expect(row?.workDateDisplay).toBe('2026-08-26')
    expect(row?.clockInDisplay).toBe('09:03')
    expect(row?.clockOutDisplay).toBe('18:05')
  })

  test('地點欄一律顯示 EMPTY_DISPLAY，即使 address 有值（計畫 §4.8 反查暫停）', () => {
    const [row] = toDisplayRows([buildItem({ clockInAddress: '台北市信義區', clockOutAddress: '台北市信義區' })], $t)
    expect(row?.clockInLocationDisplay).toBe(EMPTY_DISPLAY)
    expect(row?.clockOutLocationDisplay).toBe(EMPTY_DISPLAY)
  })

  test('工時由分鐘轉換為「H.M 小時」', () => {
    const [row] = toDisplayRows([buildItem({ workedMinutes: 510 })], $t)
    expect(row?.workedHoursDisplay).toBe('8.5 attendance.unit.hours')
  })

  test('遲到／早退為零時顯示 EMPTY_DISPLAY（UI 12 明文）', () => {
    const [row] = toDisplayRows([buildItem({ lateMinutes: 0, earlyLeaveMinutes: 15 })], $t)
    expect(row?.lateDisplay).toBe(EMPTY_DISPLAY)
    expect(row?.earlyLeaveDisplay).toBe('15 attendance.unit.minutes')
  })

  test('狀態是陣列：同一天可以同時顯示多個出勤狀態（UI 12 明文）', () => {
    const [row] = toDisplayRows([buildItem({ statuses: ['LATE', 'EARLY_LEAVE', 'ABSENT'] })], $t)
    expect(row?.statuses).toEqual([
      { text: 'attendance.result-status.late', tone: 'warning' },
      { text: 'attendance.result-status.early-leave', tone: 'warning' },
      { text: 'attendance.result-status.absent', tone: 'danger' },
    ])
  })

  test('來源：sourceTypeCode 為 null 時顯示 EMPTY_DISPLAY', () => {
    const [row] = toDisplayRows([buildItem({ sourceTypeCode: null })], $t)
    expect(row?.sourceLabel).toBe(EMPTY_DISPLAY)
  })
})
