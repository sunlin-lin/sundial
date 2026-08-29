import { describe, expect, test } from 'bun:test'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type {
  AttendanceRecordsGetData,
  AttendanceRecordsListByDateData,
  EmployeesMainListData,
} from '../../../api/generated/api-client.ts'
import {
  ATTENDANCE_TYPE_CLOCK_IN,
  ATTENDANCE_TYPE_CLOCK_OUT,
  accuracyMetersDisplay,
  attendanceTypeLabel,
  deriveCoordinateDisplayState,
  revokedRowClass,
  sourceTypeLabel,
  toDetailDisplay,
  toDisplayRows,
  toEmployeeOptions,
} from './attendance-daily-records.view.ts'

const $t = (key: string): string => key

describe('attendanceTypeLabel／sourceTypeLabel：對齊後端代碼', () => {
  test('打卡類型', () => {
    expect(attendanceTypeLabel(ATTENDANCE_TYPE_CLOCK_IN, $t)).toBe('attendance-daily-records.type.clock-in')
    expect(attendanceTypeLabel(ATTENDANCE_TYPE_CLOCK_OUT, $t)).toBe('attendance-daily-records.type.clock-out')
  })

  test('打卡來源', () => {
    expect(sourceTypeLabel(1, $t)).toBe('attendance-daily-records.source.field')
    expect(sourceTypeLabel(2, $t)).toBe('attendance-daily-records.source.manual-correction')
  })
})

describe('toDisplayRows：列表呈現', () => {
  type ListItem = AttendanceRecordsListByDateData['data'][number]

  const buildItem = (overrides: Partial<ListItem>): ListItem => ({
    id: 'record-1',
    employeeId: 'employee-1',
    employeeCode: 'E001',
    employeeName: '王小明',
    departmentName: '人資部',
    employmentId: 'employment-1',
    workDate: '2026-08-28',
    attendanceTypeCode: ATTENDANCE_TYPE_CLOCK_IN,
    sourceTypeCode: 1,
    clockedAt: '2026-08-28 09:00:00',
    address: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    ...overrides,
  })

  test('有效紀錄：狀態顯示「有效」，isRevoked 為 false', () => {
    const [row] = toDisplayRows([buildItem({})], $t)
    expect(row?.statusLabel).toBe('attendance-daily-records.status.active')
    expect(row?.isRevoked).toBe(false)
  })

  test('已撤銷紀錄：狀態顯示「已撤銷」，isRevoked 為 true', () => {
    const [row] = toDisplayRows([buildItem({ revokedAt: '2026-08-28 10:00:00', revokedBy: 'op-1' })], $t)
    expect(row?.statusLabel).toBe('attendance-daily-records.status.revoked')
    expect(row?.isRevoked).toBe(true)
  })

  test('查無部門歸屬時顯示 EMPTY_DISPLAY，不是查詢失敗', () => {
    const [row] = toDisplayRows([buildItem({ departmentName: null })], $t)
    expect(row?.departmentName).toBe(EMPTY_DISPLAY)
  })

  test('地點欄一律顯示 EMPTY_DISPLAY——即使 address 有值也一樣（計畫 §4.8 反查暫停）', () => {
    const [row] = toDisplayRows([buildItem({ address: '台北市信義區' })], $t)
    expect(row?.locationDisplay).toBe(EMPTY_DISPLAY)
  })
})

describe('revokedRowClass：已撤銷整列灰階', () => {
  test('已撤銷回傳灰階 class', () => {
    expect(revokedRowClass({ isRevoked: true })).toBe('opacity-50')
  })

  test('有效紀錄不加任何 class', () => {
    expect(revokedRowClass({ isRevoked: false })).toBe('')
  })
})

describe('deriveCoordinateDisplayState：座標三種狀態（計畫 §4.2、UI 23），兩層判斷不能合併', () => {
  type GetDetail = NonNullable<AttendanceRecordsGetData>

  const buildDetail = (overrides: Partial<GetDetail>): GetDetail => ({
    id: 'record-1',
    employeeId: 'employee-1',
    employmentId: 'employment-1',
    workDate: '2026-08-28',
    attendanceTypeCode: ATTENDANCE_TYPE_CLOCK_IN,
    sourceTypeCode: 1,
    clockedAt: '2026-08-28 09:00:00',
    latitude: 25.03,
    longitude: 121.56,
    accuracyMeters: 10,
    address: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    createdAt: '2026-08-28 09:00:00',
    updatedAt: '2026-08-28 09:00:00',
    ...overrides,
  })

  test('有權限、有 GPS：顯示實際座標', () => {
    const state = deriveCoordinateDisplayState(buildDetail({ latitude: 25.03, longitude: 121.56 }))
    expect(state).toEqual({ kind: 'visible', latitude: 25.03, longitude: 121.56 })
  })

  test('有權限、沒有 GPS：兩把鍵存在但值為 null，不是「無權限」那一種', () => {
    const state = deriveCoordinateDisplayState(buildDetail({ latitude: null, longitude: null }))
    expect(state).toEqual({ kind: 'no-gps' })
  })

  test('沒有權限：鍵完全不存在時判定為「無權限」，不是「沒有 GPS」', () => {
    const detail = buildDetail({})
    // 模擬後端「沒有權限」的回應：`latitude`／`longitude` 這兩把鍵整個不出現（不是 undefined）。
    const withoutKeys = { ...detail } as Record<string, unknown>
    delete withoutKeys['latitude']
    delete withoutKeys['longitude']
    expect('latitude' in withoutKeys).toBe(false)

    const state = deriveCoordinateDisplayState(withoutKeys as unknown as GetDetail)
    expect(state).toEqual({ kind: 'no-permission' })
  })

  test('三種狀態的 kind 兩兩不同——三種文字不得相同（UI 23 原文）', () => {
    const visible = deriveCoordinateDisplayState(buildDetail({}))
    const noGps = deriveCoordinateDisplayState(buildDetail({ latitude: null, longitude: null }))
    const kinds = new Set([visible.kind, noGps.kind, 'no-permission'])
    expect(kinds.size).toBe(3)
  })
})

describe('accuracyMetersDisplay：不用 Number(...) 轉型', () => {
  test('null 顯示 EMPTY_DISPLAY', () => {
    expect(accuracyMetersDisplay(null)).toBe(EMPTY_DISPLAY)
  })

  test('number 直接顯示', () => {
    expect(accuracyMetersDisplay(10)).toBe('10')
  })

  test('string（後端形狀缺口造成的型別）也能直接顯示', () => {
    expect(accuracyMetersDisplay('10')).toBe('10')
  })
})

describe('toDetailDisplay：get 回應 → 明細顯示', () => {
  type GetDetail = NonNullable<AttendanceRecordsGetData>

  const detail: GetDetail = {
    id: 'record-1',
    employeeId: 'employee-1',
    employmentId: 'employment-1',
    workDate: '2026-08-28',
    attendanceTypeCode: ATTENDANCE_TYPE_CLOCK_OUT,
    sourceTypeCode: 2,
    clockedAt: '2026-08-28 18:00:00',
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    address: '台北市信義區',
    revokedAt: '2026-08-28 19:00:00',
    revokedBy: 'operator-1',
    revokeReason: '打錯卡',
    createdAt: '2026-08-28 18:00:00',
    updatedAt: '2026-08-28 19:00:00',
  }

  const row = { employeeName: '王小明', departmentName: '人資部' }

  test('員工姓名／部門來自呼叫端傳入的列，不是 get 回應本身的欄位', () => {
    const result = toDetailDisplay(detail, row, $t)
    expect(result.employeeName).toBe('王小明')
    expect(result.departmentName).toBe('人資部')
  })

  test('地點一律顯示 EMPTY_DISPLAY（§4.8），即使 address 有值', () => {
    expect(toDetailDisplay(detail, row, $t).locationDisplay).toBe(EMPTY_DISPLAY)
  })

  test('已撤銷紀錄帶出撤銷時間／撤銷人／撤銷原因', () => {
    const result = toDetailDisplay(detail, row, $t)
    expect(result.isRevoked).toBe(true)
    expect(result.revokedAtDisplay).toBe('2026-08-28 19:00')
    expect(result.revokedByDisplay).toBe('operator-1')
    expect(result.revokeReasonDisplay).toBe('打錯卡')
  })

  test('有效紀錄的撤銷欄位顯示 EMPTY_DISPLAY', () => {
    const activeDetail = { ...detail, revokedAt: null, revokedBy: null, revokeReason: null }
    const result = toDetailDisplay(activeDetail, row, $t)
    expect(result.isRevoked).toBe(false)
    expect(result.revokedAtDisplay).toBe(EMPTY_DISPLAY)
    expect(result.revokedByDisplay).toBe(EMPTY_DISPLAY)
    expect(result.revokeReasonDisplay).toBe(EMPTY_DISPLAY)
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
