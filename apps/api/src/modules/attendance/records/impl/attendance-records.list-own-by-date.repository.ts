/**
 * 資料存取：依日期查本人打卡（分頁），供 Dashboard「今日打卡狀態」重新整理後仍能還原、
 * 日後「我的出勤」查別天沿用（計畫 §4.3、§4.7 的延伸，見 `attendance-records.routes.ts` 端點說明）。
 *
 * **單表查詢，沒有 JOIN**：範圍已經是呼叫者本人的 `employeeId`，不需要員工姓名／工號／部門這些
 * 只有「查別人」時才需要的欄位（比較 `attendance-records.list-by-date.repository.ts`），因此
 * 用 `TenantDatabase.select` 就足夠，不必比照那支改用裸 `runner`——這裡沒有 `LEFT JOIN`，
 * §2.3.1「`scopeAll` 遇到 `LEFT JOIN` 會悄悄變成 `INNER JOIN`」的坑不適用。
 *
 * **恆不 select 座標欄位**（計畫 §4.2：列表一律不回座標），因此這支查詢從語法上就寫不出
 * 「列表洩漏座標」——不是「查了但不回」，是查詢本身沒有把那兩欄列進 `select`。
 *
 * **含已撤銷紀錄**：與 `list-by-date` 同一個理由——呼叫端（Dashboard／我的出勤）需要知道「這筆
 * 本來就已經被撤銷」，才能正確重建今日打卡狀態，不能因為篩掉已撤銷紀錄而誤判成「今天還沒打卡」。
 *
 * 總查詢次數固定 2 次（分頁列一次、總筆數一次，同一組條件），不隨頁面筆數或公司規模成長。
 */
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords } from '../../../../db/schema/index.ts'
import type {
  ListOwnAttendanceRecordsByDatePage,
  ListOwnAttendanceRecordsByDateQuery,
  OwnAttendanceRecordListItem,
} from '../domain/attendance-record-model.ts'

const buildConditions = (employeeId: string, query: ListOwnAttendanceRecordsByDateQuery): SQL | undefined =>
  and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.workDate, query.workDate))

export const listOwnAttendanceRecordsByDate = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  query: ListOwnAttendanceRecordsByDateQuery,
): Promise<ListOwnAttendanceRecordsByDatePage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const conditions = buildConditions(employeeId, query)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await tenant
    .select(
      {
        id: attendanceRecords.id,
        employmentId: attendanceRecords.employmentId,
        workDate: attendanceRecords.workDate,
        attendanceTypeCode: attendanceRecords.attendanceTypeCode,
        sourceTypeCode: attendanceRecords.sourceTypeCode,
        clockedAt: attendanceRecords.clockedAt,
        address: attendanceRecords.address,
        revokedAt: attendanceRecords.revokedAt,
        revokedBy: attendanceRecords.revokedBy,
        revokeReason: attendanceRecords.revokeReason,
      },
      attendanceRecords,
      conditions,
    )
    .orderBy(direction(attendanceRecords.clockedAt), asc(attendanceRecords.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.select({ total: count() }, attendanceRecords, conditions)

  const items: readonly OwnAttendanceRecordListItem[] = rows.map((row) => ({
    id: row.id,
    employmentId: row.employmentId,
    workDate: row.workDate,
    attendanceTypeCode: row.attendanceTypeCode,
    sourceTypeCode: row.sourceTypeCode,
    clockedAt: row.clockedAt,
    address: row.address,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokeReason: row.revokeReason,
  }))

  return { items, totalCount: totals[0]?.total ?? 0 }
}
