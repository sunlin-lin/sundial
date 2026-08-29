/**
 * 資料存取：依日期查全公司打卡（分頁），供每日全員打卡明細使用（計畫 §4.7）。
 *
 * **一次 JOIN 帶出員工姓名／工號／部門，不逐列查詢**（`dev-standards-backend.md` §4.5）：
 * 員工（`INNER JOIN`，`attendance_records.employee_id` 必填）、部門歷史與部門（兩個 `LEFT JOIN`，
 * 這一天不一定查得到部門歸屬——理論上不會發生，但查不到時仍要讓這一列打卡顯示出來，不能因為
 * 部門缺席就整列消失）。
 *
 * **不使用 `TenantDatabase.selectFrom`＋`scopeAll`**：`scopeAll` 會把每張表的 `company_id`
 * 條件全部塞進同一個 `WHERE`，但 `employee_department_histories`／`departments` 是 `LEFT JOIN`
 * ——把它們的 `company_id` 條件放進 `WHERE` 會把 `LEFT JOIN` 悄悄變成 `INNER JOIN`（落空的那些列
 * 因為 `NULL = 公司 ID` 恆為假而被整列濾掉），這一頁「查不到部門也要顯示這筆打卡」的需求就沒了。
 * 因此改為裸 `runner`，公司範圍條件按每個 JOIN 各自的性質分別擺放：`LEFT JOIN` 的公司條件放進
 * 該 JOIN 自己的 `ON`，`WHERE` 只放錨點資料表（`attendance_records`）與業務篩選條件——
 * 形狀比照 `company-users/roles/impl/company-users-roles.list-page.repository.ts`。
 *
 * **恆不 select 座標欄位**（計畫 §4.2：列表一律不回座標，只有 `get` 明細才回），因此這支查詢
 * 從語法上就寫不出「列表洩漏座標」——不是「查了但不回」，是查詢本身沒有把那兩欄列進 `select`。
 *
 * **含已撤銷紀錄，但可用 `status` 篩選**：這一頁服務的是「今天實際發生了哪些打卡事件」的審核情境，
 * 預設（`status='all'`）不加任何撤銷相關條件，讓「這筆本來就已經被撤銷」也顯示出來（計畫 §4.7、
 * UI 23）；`status='active'`／`'revoked'` 才依 `revoked_at IS NULL` 篩選——與 `revoked_seq = 0`
 * 等價（同一筆記錄只會撤銷一次，見 `impl/attendance-records.revoke.repository.ts` 的
 * `revokedSeq` 註解），選 `revoked_at` 是因為 UI 23「狀態」欄本身就是用它判斷的，兩處判準一致。
 *
 * **排序：先依員工（工號），同一員工再依打卡時間由早到晚（UI 23，預設排序）**。`sort.field` 是
 * `employeeCode` 時，次序是 `employeeCode`（依 `sort.order`）→ `clockedAt`（恆 `asc`，同一員工的
 * 事件永遠照發生順序排，不受 `sort.order` 影響）→ `id`（恆 `asc`，分頁邊界的最終防線，見下方）；
 * `sort.field` 是 `clockedAt` 時，次序是 `clockedAt`（依 `sort.order`）→ `id`。**兩種情況都以
 * `id` 收尾**：`employeeCode` 或 `clockedAt` 都不保證全域唯一（工號可能重複排序值相同的情境是
 * 同一位員工的多筆打卡；`clockedAt` 兩位不同員工可能剛好同一秒打卡），沒有唯一鍵收尾時，
 * `LIMIT`／`OFFSET` 分頁在並列的列之間沒有穩定順序保證——同一筆資料可能同時出現在第 1 頁與
 * 第 2 頁，或兩頁都沒有；加了 `id` 之後整個排序鍵組合對每一列都唯一，分頁結果就是確定的。
 *
 * ## 總查詢次數：固定 2 次，不隨頁面筆數或公司規模成長
 *
 * 1. 分頁列一次（`LIMIT`／`OFFSET`）。
 * 2. 總筆數一次，使用完全相同的 `FROM`／`JOIN`／`WHERE`——`departmentId` 篩選要靠
 *    `employee_department_histories`／`departments` 兩個 JOIN 才篩得到，兩次查詢的 JOIN 必須
 *    一致，否則分頁列與 `totalCount` 對不起來。
 */
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { attendanceRecords, departments, employeeDepartmentHistories, employees } from '../../../../db/schema/index.ts'
import type {
  AttendanceRecordListItem,
  ListAttendanceRecordsByDatePage,
  ListAttendanceRecordsByDateQuery,
} from '../domain/attendance-record-model.ts'

/**
 * 部門歷史的 JOIN 條件：公司範圍（見檔頭）＋ join key ＋ 日期範圍比較
 * （`effective_from <= 查詢日期 <= effective_to`）。日期範圍與公司範圍同樣必須放在 `ON`，
 * 不能放 `WHERE`——理由相同，`LEFT JOIN` 落空的列不該被這個條件濾掉。
 */
const buildDepartmentHistoryJoinCondition = (companyId: string, workDate: string) =>
  and(
    eq(employeeDepartmentHistories.companyId, companyId),
    eq(employeeDepartmentHistories.employmentId, attendanceRecords.employmentId),
    lte(employeeDepartmentHistories.effectiveFrom, workDate),
    or(isNull(employeeDepartmentHistories.effectiveTo), gte(employeeDepartmentHistories.effectiveTo, workDate)),
  )

/** `status` → 撤銷相關條件。`'all'` 時不加條件（見檔頭「含已撤銷紀錄，但可用 status 篩選」）。 */
const buildStatusCondition = (status: ListAttendanceRecordsByDateQuery['status']): SQL | undefined => {
  if (status === 'active') return isNull(attendanceRecords.revokedAt)
  if (status === 'revoked') return isNotNull(attendanceRecords.revokedAt)
  return undefined
}

/**
 * `WHERE` 只放錨點資料表（`attendance_records`，§4.2 一定要有的公司條件）與業務篩選條件。
 * `departmentId` 篩選比對的是 `LEFT JOIN` 帶出來的 `employee_department_histories.department_id`
 * ——刻意放這裡（不是 ON）：使用者主動篩選「這個部門」時，查不到部門歸屬的打卡本來就該被排除，
 * 這與「不篩選時仍要顯示查無部門的打卡」是兩種不同的需求，只有後者才不能把條件放進 WHERE。
 */
const buildConditions = (companyId: string, query: ListAttendanceRecordsByDateQuery): SQL | undefined =>
  and(
    eq(attendanceRecords.companyId, companyId),
    eq(attendanceRecords.workDate, query.workDate),
    query.employeeId === null ? undefined : eq(attendanceRecords.employeeId, query.employeeId),
    query.departmentId === null ? undefined : eq(employeeDepartmentHistories.departmentId, query.departmentId),
    buildStatusCondition(query.status),
  )

/** 排序鍵組合，見檔頭「排序」段——不管主鍵是哪一欄，一律以 `id` 收尾確保分頁穩定。 */
const buildOrderBy = (query: ListAttendanceRecordsByDateQuery) => {
  const direction = query.sort.order === 'desc' ? desc : asc
  if (query.sort.field === 'employeeCode') {
    return [direction(employees.employeeCode), asc(attendanceRecords.clockedAt), asc(attendanceRecords.id)]
  }
  return [direction(attendanceRecords.clockedAt), asc(attendanceRecords.id)]
}

export const listAttendanceRecordsByDate = async (
  runner: QueryRunner,
  companyId: string,
  query: ListAttendanceRecordsByDateQuery,
): Promise<ListAttendanceRecordsByDatePage> => {
  const conditions = buildConditions(companyId, query)
  const departmentHistoryJoin = buildDepartmentHistoryJoinCondition(companyId, query.workDate)
  const orderBy = buildOrderBy(query)

  const rows = await runner
    .select({
      id: attendanceRecords.id,
      employeeId: attendanceRecords.employeeId,
      employeeCode: employees.employeeCode,
      employeeName: employees.name,
      departmentName: departments.name,
      employmentId: attendanceRecords.employmentId,
      workDate: attendanceRecords.workDate,
      attendanceTypeCode: attendanceRecords.attendanceTypeCode,
      sourceTypeCode: attendanceRecords.sourceTypeCode,
      clockedAt: attendanceRecords.clockedAt,
      address: attendanceRecords.address,
      revokedAt: attendanceRecords.revokedAt,
      revokedBy: attendanceRecords.revokedBy,
      revokeReason: attendanceRecords.revokeReason,
      revokedSeq: attendanceRecords.revokedSeq,
    })
    .from(attendanceRecords)
    .innerJoin(
      employees,
      and(eq(employees.id, attendanceRecords.employeeId), eq(employees.companyId, attendanceRecords.companyId)),
    )
    .leftJoin(employeeDepartmentHistories, departmentHistoryJoin)
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
    .from(attendanceRecords)
    .innerJoin(
      employees,
      and(eq(employees.id, attendanceRecords.employeeId), eq(employees.companyId, attendanceRecords.companyId)),
    )
    .leftJoin(employeeDepartmentHistories, departmentHistoryJoin)
    .leftJoin(
      departments,
      and(eq(departments.id, employeeDepartmentHistories.departmentId), eq(departments.companyId, companyId)),
    )
    .where(conditions)

  const items: readonly AttendanceRecordListItem[] = rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    departmentName: row.departmentName,
    employmentId: row.employmentId,
    workDate: row.workDate,
    attendanceTypeCode: row.attendanceTypeCode,
    sourceTypeCode: row.sourceTypeCode,
    clockedAt: row.clockedAt,
    address: row.address,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokeReason: row.revokeReason,
    revokedSeq: row.revokedSeq,
  }))

  return { items, totalCount: totals[0]?.total ?? 0 }
}
