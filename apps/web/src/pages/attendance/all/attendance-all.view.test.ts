import { describe, expect, test } from 'bun:test'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { EmployeesMainListData } from '../../../api/generated/api-client.ts'
import { toDisplayRows, toEmployeeOptions, type AttendanceAllListItem } from './attendance-all.view.ts'

const $t = (key: string): string => key

describe('toDisplayRows：全體出勤列表呈現', () => {
  const buildItem = (overrides: Partial<AttendanceAllListItem>): AttendanceAllListItem => ({
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
    employeeId: 'employee-1',
    employeeCode: 'E001',
    employeeName: '王小明',
    departmentName: '人資部',
    ...overrides,
  })

  test('日期、上下班時刻只取時刻部分（日期另有獨立一欄）', () => {
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

  test('查無部門歸屬時顯示 EMPTY_DISPLAY，不是查詢失敗', () => {
    const [row] = toDisplayRows([buildItem({ departmentName: null })], $t)
    expect(row?.departmentName).toBe(EMPTY_DISPLAY)
  })

  test('工時由分鐘轉換為「H.M 小時」', () => {
    const [row] = toDisplayRows([buildItem({ workedMinutes: 510 })], $t)
    expect(row?.workedHoursDisplay).toBe('8.5 attendance.unit.hours')
  })

  test('遲到／早退為零時顯示 EMPTY_DISPLAY，非零時顯示分鐘數', () => {
    const [zero] = toDisplayRows([buildItem({ lateMinutes: 0, earlyLeaveMinutes: 0 })], $t)
    expect(zero?.lateDisplay).toBe(EMPTY_DISPLAY)
    expect(zero?.earlyLeaveDisplay).toBe(EMPTY_DISPLAY)

    const [nonZero] = toDisplayRows([buildItem({ lateMinutes: 15, earlyLeaveMinutes: 10 })], $t)
    expect(nonZero?.lateDisplay).toBe('15 attendance.unit.minutes')
    expect(nonZero?.earlyLeaveDisplay).toBe('10 attendance.unit.minutes')
  })

  test('workedMinutes 等欄位是 string 時也能正確處理（後端形狀缺口，見 shared/format/duration.ts 檔頭）', () => {
    const [row] = toDisplayRows([buildItem({ workedMinutes: '510', lateMinutes: '15', earlyLeaveMinutes: '0' })], $t)
    expect(row?.workedHoursDisplay).toBe('8.5 attendance.unit.hours')
    expect(row?.lateDisplay).toBe('15 attendance.unit.minutes')
    expect(row?.earlyLeaveDisplay).toBe(EMPTY_DISPLAY)
  })

  test('狀態是陣列：同一列可以同時出現多個狀態，不是單一互斥值（UI 09 明文）', () => {
    const [row] = toDisplayRows([buildItem({ statuses: ['LATE', 'EARLY_LEAVE'] })], $t)
    expect(row?.statuses).toEqual([
      { text: 'attendance.result-status.late', tone: 'warning' },
      { text: 'attendance.result-status.early-leave', tone: 'warning' },
    ])
  })

  test('來源：sourceTypeCode 為 null 時顯示 EMPTY_DISPLAY（一天兩張卡都查不到時的形狀）', () => {
    const [row] = toDisplayRows([buildItem({ sourceTypeCode: null })], $t)
    expect(row?.sourceLabel).toBe(EMPTY_DISPLAY)
  })

  test('來源：1／2 分別對應現場打卡／人工補登', () => {
    const [field] = toDisplayRows([buildItem({ sourceTypeCode: 1 })], $t)
    expect(field?.sourceLabel).toBe('attendance.source.field')
    const [manual] = toDisplayRows([buildItem({ sourceTypeCode: 2 })], $t)
    expect(manual?.sourceLabel).toBe('attendance.source.manual-correction')
  })
})

describe('toEmployeeOptions：人員篩選選項', () => {
  test('把工號併進顯示文字，方便分辨同名員工', () => {
    const items: EmployeesMainListData['data'] = [
      {
        id: 'employee-1',
        employeeCode: 'E001',
        name: '王小明',
        gender: 'MALE',
        identityNumberMasked: '***123',
        jobTitleName: null,
      },
    ]
    expect(toEmployeeOptions(items)).toEqual([{ id: 'employee-1', label: 'E001 王小明' }])
  })
})
