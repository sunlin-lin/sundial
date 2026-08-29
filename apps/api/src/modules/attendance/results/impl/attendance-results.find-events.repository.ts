/**
 * 資料存取：判定引擎的輸入事件（計畫 §4.1）。
 *
 * 兩支查詢都只讀「有效」（`revoked_seq = 0`）的打卡——撤銷後的卡不參與判定，這與
 * `attendance_records` 自己的「有效狀態」規則（`revoked_at IS NULL` 等價於 `revoked_seq = 0`，
 * 見 `db/schema/attendance-records.ts` 檔頭）是同一件事，這裡比對 `revoked_seq = 0` 而不是
 * `revoked_at IS NULL`，理由與該檔「兩個欄位一起比對不是重複」相同：`revoked_seq = 0` 才是
 * 唯一鍵真正參與的那一個。
 */
import { eq, inArray } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords } from '../../../../db/schema/index.ts'
import type { AttendanceEventRow } from '../domain/attendance-result-event-grouping.ts'
import type { AttendanceResultEvent } from '../domain/attendance-result-model.ts'

/**
 * 單一員工單一工作日的有效事件（供 `revoke`／`revoke-other` 撤銷後的單筆重算使用，
 * `runner` 是撤銷所在的那筆交易，讀到的是交易內最新已提交＋本交易內的寫入）。
 */
export const findAttendanceResultEventsForWorkDay = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  workDate: string,
): Promise<readonly AttendanceResultEvent[]> => {
  const rows = await new TenantDatabase(runner, companyId).select(
    { attendanceTypeCode: attendanceRecords.attendanceTypeCode, clockedAt: attendanceRecords.clockedAt },
    attendanceRecords,
    eq(attendanceRecords.employeeId, employeeId),
    eq(attendanceRecords.workDate, workDate),
    eq(attendanceRecords.revokedSeq, 0),
  )
  return rows
}

/**
 * 批次重算用：一次查出「一批員工 × 一批工作日」交集內的全部有效事件（§4.5：批次取出再一次算完）。
 *
 * **回傳的是 `employeeId`／`workDate` 兩個 `IN` 條件的交集，不是精確的座標配對**——呼叫端
 * （批次重算 service）傳進來的 `employeeIds`／`workDates` 是各自去重後的清單，交集裡可能包含
 * 「員工 A 的清單」與「員工 B 的工作日」湊出來、根本不需要的組合；這是刻意接受的多查，換來
 * 「不論待重算筆數多少，事件查詢固定一次」。呼叫端用 `groupAttendanceEventsByEmployeeWorkDate`
 * 分組後，只會查詢真正需要的 `(employeeId, workDate)` 組合，多查到的部分不會被用到，也不影響
 * 結果正確性。
 */
export const findAttendanceResultEventRows = async (
  runner: QueryRunner,
  companyId: string,
  employeeIds: readonly string[],
  workDates: readonly string[],
): Promise<readonly AttendanceEventRow[]> => {
  if (employeeIds.length === 0 || workDates.length === 0) return []

  const rows = await new TenantDatabase(runner, companyId).select(
    {
      employeeId: attendanceRecords.employeeId,
      workDate: attendanceRecords.workDate,
      attendanceTypeCode: attendanceRecords.attendanceTypeCode,
      clockedAt: attendanceRecords.clockedAt,
    },
    attendanceRecords,
    inArray(attendanceRecords.employeeId, [...employeeIds]),
    inArray(attendanceRecords.workDate, [...workDates]),
    eq(attendanceRecords.revokedSeq, 0),
  )
  return rows
}

export type { AttendanceEventRow }
