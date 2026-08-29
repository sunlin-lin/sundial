import { describe, expect, test } from 'bun:test'
import { todayInTaipei } from '../../../shared/format/business-clock.ts'
import {
  ATTENDANCE_DAILY_RECORD_PER_PAGE,
  ATTENDANCE_DAILY_RECORD_SORT,
  defaultAttendanceDailyRecordFilters,
  emptyRevokeOtherFormState,
  toAttendanceDailyRecordListQuery,
  toRevokeOtherPayload,
} from './attendance-daily-records.payload.ts'

describe('defaultAttendanceDailyRecordFilters', () => {
  test('日期預設今天，部門與人員預設不篩選，狀態預設全部', () => {
    expect(defaultAttendanceDailyRecordFilters()).toEqual({
      date: todayInTaipei(),
      departmentId: null,
      employeeId: null,
      status: 'all',
    })
  })
})

describe('toAttendanceDailyRecordListQuery', () => {
  test('部門與人員都未篩選時，query 裡不含這兩個鍵（不是設成 undefined）；status／sort 一律送出', () => {
    const query = toAttendanceDailyRecordListQuery(
      { date: '2026-08-28', departmentId: null, employeeId: null, status: 'all' },
      1,
    )
    expect('departmentId' in query).toBe(false)
    expect('employeeId' in query).toBe(false)
    expect(query).toEqual({
      date: '2026-08-28',
      status: 'all',
      currentPage: 1,
      perPage: ATTENDANCE_DAILY_RECORD_PER_PAGE,
      sort: ATTENDANCE_DAILY_RECORD_SORT,
    })
  })

  test('有篩選部門、人員與狀態時帶入對應的鍵', () => {
    const query = toAttendanceDailyRecordListQuery(
      { date: '2026-08-28', departmentId: 'dept-1', employeeId: 'employee-1', status: 'revoked' },
      2,
    )
    expect(query).toEqual({
      date: '2026-08-28',
      departmentId: 'dept-1',
      employeeId: 'employee-1',
      status: 'revoked',
      currentPage: 2,
      perPage: ATTENDANCE_DAILY_RECORD_PER_PAGE,
      sort: ATTENDANCE_DAILY_RECORD_SORT,
    })
  })

  test('狀態選「只看有效」時送出 status: "active"，排序固定為 employeeCode 升冪（UI 23）', () => {
    const query = toAttendanceDailyRecordListQuery(
      { date: '2026-08-28', departmentId: null, employeeId: null, status: 'active' },
      1,
    )
    expect(query.status).toBe('active')
    expect(query.sort).toEqual({ field: 'employeeCode', order: 'asc' })
  })
})

describe('emptyRevokeOtherFormState', () => {
  test('初始值是空字串', () => {
    expect(emptyRevokeOtherFormState()).toEqual({ reason: '' })
  })
})

describe('toRevokeOtherPayload', () => {
  test('原因會被 trim', () => {
    expect(toRevokeOtherPayload('record-1', { reason: '  員工要求撤銷  ' })).toEqual({
      recordId: 'record-1',
      reason: '員工要求撤銷',
    })
  })
})
