/**
 * 資料存取：查詢本人的補打卡申請（分頁，依年月＋狀態篩選，UI 13）。
 *
 * **單表查詢，沒有 JOIN**：範圍已經是呼叫者本人的 `employeeId`，不需要員工姓名／工號這些「查別人」
 * 才需要的欄位，用 `TenantDatabase.select` 就足夠（比照 `attendance/records` 的
 * `list-own-by-date.repository.ts`）。
 *
 * 總查詢次數固定 2 次（分頁列一次、總筆數一次，同一組條件），不隨頁面筆數或公司規模成長。
 */
import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { attendanceCorrectionRequests, AttendanceCorrectionRequestStatusCode } from '../../../../db/schema/index.ts'
import type {
  AttendanceCorrectionRequestListStatus,
  ListOwnAttendanceCorrectionRequestsPage,
  ListOwnAttendanceCorrectionRequestsQuery,
  OwnAttendanceCorrectionRequestListItem,
} from '../domain/attendance-correction-request-model.ts'
import { resolveMonthRange } from '../domain/attendance-correction-request-month-range.ts'

/** `status` → 狀態代碼條件。`'all'` 時不加條件（UI 13「狀態可選全部……」）。 */
const buildStatusCondition = (status: AttendanceCorrectionRequestListStatus): SQL | undefined => {
  if (status === 'pending')
    return eq(attendanceCorrectionRequests.statusCode, AttendanceCorrectionRequestStatusCode.Pending)
  if (status === 'approved') {
    return eq(attendanceCorrectionRequests.statusCode, AttendanceCorrectionRequestStatusCode.Approved)
  }
  if (status === 'rejected') {
    return eq(attendanceCorrectionRequests.statusCode, AttendanceCorrectionRequestStatusCode.Rejected)
  }
  if (status === 'withdrawn') {
    return eq(attendanceCorrectionRequests.statusCode, AttendanceCorrectionRequestStatusCode.Withdrawn)
  }
  return undefined
}

const buildConditions = (
  employeeId: string,
  query: ListOwnAttendanceCorrectionRequestsQuery,
  range: { readonly start: string; readonly end: string },
): SQL | undefined =>
  and(
    eq(attendanceCorrectionRequests.employeeId, employeeId),
    gte(attendanceCorrectionRequests.workDate, range.start),
    lte(attendanceCorrectionRequests.workDate, range.end),
    buildStatusCondition(query.status),
  )

export const listOwnAttendanceCorrectionRequests = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  query: ListOwnAttendanceCorrectionRequestsQuery,
): Promise<ListOwnAttendanceCorrectionRequestsPage> => {
  const tenant = new TenantDatabase(runner, companyId)
  const range = resolveMonthRange(query.yearMonth)
  const conditions = buildConditions(employeeId, query, range)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await tenant
    .select(
      {
        id: attendanceCorrectionRequests.id,
        workDate: attendanceCorrectionRequests.workDate,
        attendanceTypeCode: attendanceCorrectionRequests.attendanceTypeCode,
        requestedClockedAt: attendanceCorrectionRequests.requestedClockedAt,
        reason: attendanceCorrectionRequests.reason,
        statusCode: attendanceCorrectionRequests.statusCode,
        createdAt: attendanceCorrectionRequests.createdAt,
        updatedAt: attendanceCorrectionRequests.updatedAt,
      },
      attendanceCorrectionRequests,
      conditions,
    )
    .orderBy(direction(attendanceCorrectionRequests.workDate), asc(attendanceCorrectionRequests.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await tenant.select({ total: count() }, attendanceCorrectionRequests, conditions)

  const items: readonly OwnAttendanceCorrectionRequestListItem[] = rows.map((row) => ({
    id: row.id,
    workDate: row.workDate,
    attendanceTypeCode: row.attendanceTypeCode,
    requestedClockedAt: row.requestedClockedAt,
    reason: row.reason,
    statusCode: row.statusCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))

  return { items, totalCount: totals[0]?.total ?? 0 }
}
