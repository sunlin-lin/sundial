/**
 * 資料存取：全體出勤（`attendance/results/list`，公司範圍，UI 09；計畫 §5 Stage 7）。
 *
 * ## 總查詢次數：固定 2 次，不隨頁面筆數或公司規模成長
 *
 * 1. 分頁列一次。
 * 2. 總筆數一次，使用完全相同的 `FROM`／`JOIN`／`WHERE`——`departmentId` 篩選要靠
 *    `employee_department_histories`／`departments` 兩個 JOIN 才篩得到，兩次查詢的 JOIN 必須
 *    一致，否則分頁列與 `totalCount` 對不起來（`sundial-backend` skill database.md §6）。
 *
 * **一次 JOIN 把「判定結果」「當天有效的上下班打卡（時間、地點、來源）」「該日有效部門」「員工
 * 姓名工號」全部帶出來，不逐列另外查詢**：錨點是 `attendance_results`（一位員工一天一列，UI 09
 * 明文），`employees` 用 `INNER JOIN`（`attendance_results.employee_id` 必填），上班卡／下班卡
 * 各自用一個別名 `LEFT JOIN` 帶出（`attendance_records` 的唯一鍵 `(employee_id, work_date,
 * attendance_type_code, revoked_seq)` 保證每個別名最多比對到一列，不會讓 `attendance_results`
 * 那一列被複製），部門歷史與部門再各用一個 `LEFT JOIN` 帶出。
 *
 * ## ★ 部門要顯示「該日有效的部門」，不是目前部門
 *
 * UI 09：「部門篩選與顯示應依查詢日期對應的有效部門資料，不應只取員工目前部門而改變歷史畫面。」
 * `attendance_results` 沒有 `employment_id`（見 `db/schema/attendance-results.ts` 檔頭第 3
 * 點），部門歷史（`employee_department_histories`）又是以 `employment_id` 為鍵（不是
 * `employee_id`），因此這裡的 `employment_id` 改由「這一天有效的打卡」取得——`attendance_records`
 * 在打卡當下就已經把操作者當時的 `employment_id` 存進去了（計畫 §4.4：「`employment_id` 由呼叫端
 * 在打卡當下依『操作者目前有效任職』查出」），不需要另外重新推導一次「這個員工這一天算誰的任職」，
 * 直接沿用打卡當時已經解析好的結果，兩者本來就必須一致。優先取上班卡的 `employment_id`，上班卡
 * 不存在才退回下班卡（見 `buildDepartmentHistoryJoinCondition`）。
 *
 * 部門歷史的 JOIN 條件用 `attendance_results.work_date`（每一列各自的日期，不是查詢參數裡的固定
 * 一天）比對 `effective_from`／`effective_to` 區間——同一個查詢裡，一月份的每一列各自對照自己
 * 那一天的有效部門，員工三月調過部門，查一月的資料時，一月的每一列仍然各自比對出當時（一月）的
 * 部門，不會因為現在（查詢當下）已經調到新部門而改變歷史畫面。
 *
 * **不使用 `TenantDatabase.selectFrom`＋`scopeAll`**：`employee_department_histories`／
 * `departments` 是 `LEFT JOIN`，把它們的 `company_id` 條件放進 `scopeAll` 產生的 `WHERE` 會把
 * `LEFT JOIN` 悄悄變成 `INNER JOIN`（`sundial-backend` skill database.md §2.3.1）——查不到部門
 * 的員工那一天的出勤會整列從結果消失，而不是 `departmentName: null`。因此改用裸 `runner`，公司
 * 範圍條件依 JOIN 性質分別擺放：`LEFT JOIN` 的公司條件放進該 JOIN 自己的 `ON`，`WHERE` 只放錨點
 * 資料表（`attendance_results`）與業務篩選條件，形狀比照 `attendance/records/impl/
 * attendance-records.list-by-date.repository.ts`。
 *
 * **恆不 select 座標欄位**（計畫 §4.2：列表一律不回座標），因此這支查詢從語法上就寫不出「列表
 * 洩漏座標」——不是「查了但不回」，是查詢本身沒有把那兩欄列進 `select`。
 */
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { QueryRunner } from '../../../../db/client.ts'
import {
  attendanceRecords,
  attendanceResults,
  AttendanceTypeCode,
  departments,
  employeeDepartmentHistories,
  employees,
} from '../../../../db/schema/index.ts'
import {
  buildAttendanceResultListCore,
  toAttendanceResultClockEvent,
  type AttendanceResultListItem,
  type ListAttendanceResultsPage,
  type ListAttendanceResultsQuery,
} from '../domain/attendance-result-list-view.ts'
import { resolveMonthRange } from '../domain/attendance-result-month-range.ts'

/** 上班卡／下班卡各自的別名，避免 `attendance_records` 自我 JOIN 兩次時欄位無法區分（比照
 * `attendance/records/impl/attendance-records.find-punch.repository.ts` 的既有先例）。 */
const clockInAlias = alias(attendanceRecords, 'ar_clock_in')
const clockOutAlias = alias(attendanceRecords, 'ar_clock_out')

/** 上班卡／下班卡各自的 `LEFT JOIN` 條件：公司範圍＋比對錨點列的 `employee_id`／`work_date`＋
 * 固定的事件類型＋只認有效卡（`revoked_seq = 0`）。公司條件放 `ON`，理由見檔頭 §2.3.1。 */
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

/** 部門歷史的 JOIN 條件，見檔頭「★ 部門要顯示該日有效的部門」。 */
const buildDepartmentHistoryJoinCondition = (companyId: string) =>
  and(
    eq(employeeDepartmentHistories.companyId, companyId),
    or(
      and(
        isNotNull(clockInAlias.employmentId),
        eq(employeeDepartmentHistories.employmentId, clockInAlias.employmentId),
      ),
      and(isNull(clockInAlias.employmentId), eq(employeeDepartmentHistories.employmentId, clockOutAlias.employmentId)),
    ),
    lte(employeeDepartmentHistories.effectiveFrom, attendanceResults.workDate),
    or(
      isNull(employeeDepartmentHistories.effectiveTo),
      gte(employeeDepartmentHistories.effectiveTo, attendanceResults.workDate),
    ),
  )

const buildConditions = (
  companyId: string,
  query: ListAttendanceResultsQuery,
  range: { start: string; end: string },
): SQL | undefined =>
  and(
    eq(attendanceResults.companyId, companyId),
    gte(attendanceResults.workDate, range.start),
    lte(attendanceResults.workDate, range.end),
    query.employeeId === null ? undefined : eq(attendanceResults.employeeId, query.employeeId),
    // 篩選「這個部門」時，查不到部門歸屬的列本來就該被排除——與「不篩選時仍要顯示查無部門的列」
    // 是兩種不同需求，只有後者不能把條件放進 WHERE（見 list-by-date.repository.ts 同一條理由）。
    query.departmentId === null ? undefined : eq(employeeDepartmentHistories.departmentId, query.departmentId),
  )

const buildOrderBy = (query: ListAttendanceResultsQuery) => {
  const direction = query.sort.order === 'desc' ? desc : asc
  if (query.sort.field === 'employeeCode') {
    return [direction(employees.employeeCode), desc(attendanceResults.workDate), asc(attendanceResults.id)]
  }
  return [direction(attendanceResults.workDate), asc(employees.employeeCode), asc(attendanceResults.id)]
}

export const listAttendanceResults = async (
  runner: QueryRunner,
  companyId: string,
  query: ListAttendanceResultsQuery,
): Promise<ListAttendanceResultsPage> => {
  const range = resolveMonthRange(query.yearMonth)
  const conditions = buildConditions(companyId, query, range)
  const orderBy = buildOrderBy(query)

  const selection = {
    id: attendanceResults.id,
    employeeId: attendanceResults.employeeId,
    employeeCode: employees.employeeCode,
    employeeName: employees.name,
    departmentName: departments.name,
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
    .innerJoin(
      employees,
      and(eq(employees.id, attendanceResults.employeeId), eq(employees.companyId, attendanceResults.companyId)),
    )
    .leftJoin(clockInAlias, buildClockJoinCondition(companyId, clockInAlias, AttendanceTypeCode.ClockIn))
    .leftJoin(clockOutAlias, buildClockJoinCondition(companyId, clockOutAlias, AttendanceTypeCode.ClockOut))
    .leftJoin(employeeDepartmentHistories, buildDepartmentHistoryJoinCondition(companyId))
    .leftJoin(
      departments,
      and(eq(departments.id, employeeDepartmentHistories.departmentId), eq(departments.companyId, companyId)),
    )
    .where(conditions)
    .orderBy(...orderBy)
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await runner
    .select({ total: count() })
    .from(attendanceResults)
    .innerJoin(
      employees,
      and(eq(employees.id, attendanceResults.employeeId), eq(employees.companyId, attendanceResults.companyId)),
    )
    .leftJoin(clockInAlias, buildClockJoinCondition(companyId, clockInAlias, AttendanceTypeCode.ClockIn))
    .leftJoin(clockOutAlias, buildClockJoinCondition(companyId, clockOutAlias, AttendanceTypeCode.ClockOut))
    .leftJoin(employeeDepartmentHistories, buildDepartmentHistoryJoinCondition(companyId))
    .leftJoin(
      departments,
      and(eq(departments.id, employeeDepartmentHistories.departmentId), eq(departments.companyId, companyId)),
    )
    .where(conditions)

  const items: readonly AttendanceResultListItem[] = rows.map((row) => ({
    ...buildAttendanceResultListCore(
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
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    departmentName: row.departmentName,
  }))

  return { items, totalCount: totals[0]?.total ?? 0 }
}
