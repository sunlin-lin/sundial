/**
 * 資料存取：我的出勤（`attendance/results/list-own`，本人範圍，UI 12；計畫 §5 Stage 7）。
 *
 * 形狀比照 `impl/attendance-results.list.repository.ts`（全體出勤），差別只有兩點：範圍已知是
 * 呼叫者本人的 `employeeId`（不需要員工姓名／工號），也不需要「該日有效部門」（UI 12 的出勤紀錄
 * 列表沒有部門欄——查的必然是自己，見 `domain/attendance-result-list-view.ts` 的
 * `OwnAttendanceResultListItem` 檔頭）。因此比 `list` 少兩個 JOIN（`employees`／部門歷史與部門），
 * 只保留上班卡／下班卡兩個別名 `LEFT JOIN`。
 *
 * ## 總查詢次數：固定 2 次（分頁列一次、總筆數一次，同一組條件），不隨頁面筆數或公司規模成長。
 *
 * **不使用 `TenantDatabase.selectFrom`＋`scopeAll`**：即使這裡少了部門那兩個 JOIN，上班卡／下班卡
 * 兩個別名仍然是 `LEFT JOIN`，`scopeAll` 一樣會把它們的 `company_id` 條件塞進 `WHERE`，讓「這天
 * 只有上班卡沒有下班卡」的列被誤判成整列消失（§2.3.1）。因此比照 `list.repository.ts`，改用裸
 * `runner`，`LEFT JOIN` 的公司條件放進該 JOIN 自己的 `ON`。
 *
 * **恆不 select 座標欄位**（計畫 §4.2：列表一律不回座標）。
 */
import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords, attendanceResults, AttendanceTypeCode } from '../../../../db/schema/index.ts'
import {
  buildAttendanceResultListCore,
  toAttendanceResultClockEvent,
  type ListOwnAttendanceResultsPage,
  type ListOwnAttendanceResultsQuery,
  type OwnAttendanceResultListItem,
} from '../domain/attendance-result-list-view.ts'
import { resolveMonthRange } from '../domain/attendance-result-month-range.ts'

const clockInAlias = alias(attendanceRecords, 'ar_clock_in')
const clockOutAlias = alias(attendanceRecords, 'ar_clock_out')

/** 見 `list.repository.ts` 的同名函式；公司條件放 `ON`，理由同檔頭 §2.3.1。 */
const buildClockJoinCondition = (
  companyId: string,
  alias_: typeof clockInAlias | typeof clockOutAlias,
  attendanceTypeCode: (typeof AttendanceTypeCode)[keyof typeof AttendanceTypeCode],
) =>
  and(
    eq(alias_.companyId, companyId),
    eq(alias_.employeeId, attendanceResults.employeeId),
    eq(alias_.workDate, attendanceResults.workDate),
    eq(alias_.attendanceTypeCode, attendanceTypeCode),
    eq(alias_.revokedSeq, 0),
  )

const buildConditions = (
  companyId: string,
  employeeId: string,
  range: { readonly start: string; readonly end: string },
): SQL | undefined =>
  and(
    eq(attendanceResults.companyId, companyId),
    eq(attendanceResults.employeeId, employeeId),
    gte(attendanceResults.workDate, range.start),
    lte(attendanceResults.workDate, range.end),
  )

const buildOrderBy = (query: ListOwnAttendanceResultsQuery) => {
  const direction = query.sort.order === 'desc' ? desc : asc
  return [direction(attendanceResults.workDate), asc(attendanceResults.id)]
}

export const listOwnAttendanceResults = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  query: ListOwnAttendanceResultsQuery,
): Promise<ListOwnAttendanceResultsPage> => {
  const range = resolveMonthRange(query.yearMonth)
  const conditions = buildConditions(companyId, employeeId, range)
  const orderBy = buildOrderBy(query)

  const selection = {
    id: attendanceResults.id,
    workDate: attendanceResults.workDate,
    workedMinutes: attendanceResults.workedMinutes,
    lateMinutes: attendanceResults.lateMinutes,
    earlyLeaveMinutes: attendanceResults.earlyLeaveMinutes,
    absenceMinutes: attendanceResults.absenceMinutes,
    leaveMinutes: attendanceResults.leaveMinutes,
    resultStatusCode: attendanceResults.resultStatusCode,
    clockInAt: clockInAlias.clockedAt,
    clockInAddress: clockInAlias.address,
    clockInSourceTypeCode: clockInAlias.sourceTypeCode,
    clockOutAt: clockOutAlias.clockedAt,
    clockOutAddress: clockOutAlias.address,
    clockOutSourceTypeCode: clockOutAlias.sourceTypeCode,
  } as const

  const rows = await runner
    .select(selection)
    .from(attendanceResults)
    .leftJoin(clockInAlias, buildClockJoinCondition(companyId, clockInAlias, AttendanceTypeCode.ClockIn))
    .leftJoin(clockOutAlias, buildClockJoinCondition(companyId, clockOutAlias, AttendanceTypeCode.ClockOut))
    .where(conditions)
    .orderBy(...orderBy)
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await runner
    .select({ total: count() })
    .from(attendanceResults)
    .leftJoin(clockInAlias, buildClockJoinCondition(companyId, clockInAlias, AttendanceTypeCode.ClockIn))
    .leftJoin(clockOutAlias, buildClockJoinCondition(companyId, clockOutAlias, AttendanceTypeCode.ClockOut))
    .where(conditions)

  const items: readonly OwnAttendanceResultListItem[] = rows.map((row) =>
    buildAttendanceResultListCore(
      {
        id: row.id,
        workDate: row.workDate,
        workedMinutes: row.workedMinutes,
        lateMinutes: row.lateMinutes,
        earlyLeaveMinutes: row.earlyLeaveMinutes,
        absenceMinutes: row.absenceMinutes,
        leaveMinutes: row.leaveMinutes,
        resultStatusCode: row.resultStatusCode,
      },
      toAttendanceResultClockEvent(row.clockInAt, row.clockInAddress, row.clockInSourceTypeCode),
      toAttendanceResultClockEvent(row.clockOutAt, row.clockOutAddress, row.clockOutSourceTypeCode),
    ),
  )

  return { items, totalCount: totals[0]?.total ?? 0 }
}
