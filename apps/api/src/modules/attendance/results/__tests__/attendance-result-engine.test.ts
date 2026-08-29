/**
 * 判定引擎的單元測試（零 IO，不連資料庫）。計畫 §4.1：無班表時 `worked_minutes` 算得出來，
 * 其餘五個數值欄位固定 `0`，狀態碼固定 `NO_SCHEDULE`。
 */
import { describe, expect, test } from 'bun:test'
import { AttendanceResultStatusCode, AttendanceTypeCode } from '../../../../db/schema/index.ts'
import { computeAttendanceResult } from '../domain/attendance-result-engine.ts'
import type { AttendanceResultEvent } from '../domain/attendance-result-model.ts'

const clockIn = (clockedAt: string): AttendanceResultEvent => ({
  attendanceTypeCode: AttendanceTypeCode.ClockIn,
  clockedAt,
})
const clockOut = (clockedAt: string): AttendanceResultEvent => ({
  attendanceTypeCode: AttendanceTypeCode.ClockOut,
  clockedAt,
})

describe('computeAttendanceResult（schedule=null，本階段唯一會發生的分支）', () => {
  test('沒有任何有效打卡：worked_minutes=0，其餘欄位固定 0，狀態為 NO_SCHEDULE', () => {
    const result = computeAttendanceResult([], null)
    expect(result).toEqual({
      scheduledMinutes: 0,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      absenceMinutes: 0,
      leaveMinutes: 0,
      overtimeMinutes: 0,
      resultStatusCode: AttendanceResultStatusCode.NoSchedule,
    })
  })

  test('只有上班卡、沒有下班卡：算不出一組完整的工作時間，worked_minutes=0', () => {
    const result = computeAttendanceResult([clockIn('2026-08-29 09:00:00')], null)
    expect(result.workedMinutes).toBe(0)
  })

  test('只有下班卡、沒有上班卡：worked_minutes=0', () => {
    const result = computeAttendanceResult([clockOut('2026-08-29 18:00:00')], null)
    expect(result.workedMinutes).toBe(0)
  })

  test('有一組完整的上下班卡：worked_minutes 是兩者的分鐘差', () => {
    const result = computeAttendanceResult([clockIn('2026-08-29 09:00:00'), clockOut('2026-08-29 18:00:00')], null)
    expect(result.workedMinutes).toBe(9 * 60)
    expect(result.resultStatusCode).toBe(AttendanceResultStatusCode.NoSchedule)
  })

  test('跨日：22:00 上班、隔天 05:50 下班，時間差跨過午夜仍正確換算', () => {
    const result = computeAttendanceResult([clockIn('2026-08-29 22:00:00'), clockOut('2026-08-30 05:50:00')], null)
    expect(result.workedMinutes).toBe(7 * 60 + 50)
  })

  test('下班卡早於上班卡（資料異常）：不回負值，回 0', () => {
    const result = computeAttendanceResult([clockIn('2026-08-29 18:00:00'), clockOut('2026-08-29 09:00:00')], null)
    expect(result.workedMinutes).toBe(0)
  })

  test('事件陣列裡的順序不影響結果（配對靠 attendanceTypeCode，不是陣列順序）', () => {
    const result = computeAttendanceResult([clockOut('2026-08-29 18:00:00'), clockIn('2026-08-29 09:00:00')], null)
    expect(result.workedMinutes).toBe(9 * 60)
  })
})
