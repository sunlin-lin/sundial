/**
 * 資料存取：批次重算要處理的座標清單（計畫 §4.1、§5 Stage 4）。
 *
 * 查全公司目前狀態為 `NO_SCHEDULE` 的判定結果——這是批次重算「一次取出再一次算完」（§4.5）
 * 的第一步，走 `ix_attendance_results_company_status`（`db/schema/attendance-results.ts`）。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceResults, AttendanceResultStatusCode } from '../../../../db/schema/index.ts'

export type PendingAttendanceResult = {
  readonly employeeId: string
  readonly workDate: string
}

export const findNoScheduleAttendanceResults = async (
  runner: QueryRunner,
  companyId: string,
): Promise<readonly PendingAttendanceResult[]> => {
  const rows = await new TenantDatabase(runner, companyId).select(
    { employeeId: attendanceResults.employeeId, workDate: attendanceResults.workDate },
    attendanceResults,
    eq(attendanceResults.resultStatusCode, AttendanceResultStatusCode.NoSchedule),
  )
  return rows
}
