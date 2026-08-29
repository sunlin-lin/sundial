/**
 * 資料存取：判定結果的寫回。**刻意不透過 `TenantDatabase.insert`／`insertMany`**，這是一個
 * 有記錄的例外，不是繞過封裝，比照 `sundial-backend` skill §2.3.1（`scopeAll` 遇 `LEFT JOIN`
 * 那個例外）同一種「文件化偏離」處理方式。
 *
 * ## 為什麼要繞過 `TenantDatabase`
 *
 * `attendance_results` 的唯一鍵 `(company_id, employee_id, work_date)` 就是判定結果的自然身分
 * ——重算是「原地覆蓋既有那一筆」，不是「再插一筆」。若照 `TenantDatabase.insert` 的標準流程，
 * 每次重算都要先判斷「這一筆存不存在」，而先查再寫在併發下有競爭視窗：兩個交易可能同時判斷
 * 「這天還沒有判定結果」而各自嘗試 `INSERT`，後寫入的那個撞唯一鍵——這正是資料庫規範 §4.3
 * 明文禁止的「先 SELECT 再 INSERT」模式（`sundial-backend` skill `references/database.md` §3.3）。
 *
 * 正確作法是單一語句的 `INSERT ... ON DUPLICATE KEY UPDATE`：資料庫自己判斷這一列是否已存在，
 * 一個語句同時涵蓋「這天第一次有判定」與「這天重算」兩種情況，不需要應用層先查一次。但
 * `TenantDatabase` 目前沒有暴露 `onDuplicateKeyUpdate`（`db/client.ts` 的 `insert`／
 * `insertMany` 只包了最單純的 `INSERT`），因此這裡改用裸 `runner`。
 *
 * ## 為什麼公司隔離仍然成立
 *
 * `TenantDatabase` 的價值是讓「不帶公司條件」在型別上寫不出來；這裡雖然不經過它，但
 * `companyId` 只有一個來源——呼叫端傳進來的**單一**已驗證公司範圍（來自 token，不是 request
 * body），每一列的 `company_id` 都直接寫死這個值，呼叫端**沒有機會**替不同列塞進不同的
 * `company_id`（型別上 `companyId` 是本函式的參數，不是 `rows` 陣列裡每個元素各自可以指定的
 * 欄位）。這與 `TenantDatabase.insertMany` 的 `buildRows(companyId)` 回呼保證的是同一件事：
 * 公司 ID 只有一個來源。真正需要小心的反而是唯一鍵本身——`(company_id, employee_id, work_date)`
 * 三欄都在唯一鍵裡，`ON DUPLICATE KEY UPDATE` 的比對天生就是同公司內才會命中，不會有「更新到
 * 別家公司那一列」的可能。
 *
 * ## 批次與單筆共用同一支函式
 *
 * `rows` 可以是一筆（`revoke`／`revoke-other` 撤銷後的單筆重算）或多筆（批次重算「全部
 * `NO_SCHEDULE` 紀錄」）——兩種情況都是同一句 SQL，往返次數固定為一次，不隨 `rows.length`
 * 增加（§4.5）。
 */
import { sql } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { attendanceResults, type AttendanceResultStatusCodeValue } from '../../../../db/schema/index.ts'

export type UpsertAttendanceResultRow = {
  /** 新增時使用的 id；命中既有列（`ON DUPLICATE KEY UPDATE`）時這個值不會被採用，原 id 保留。 */
  readonly id: string
  readonly employeeId: string
  /** 本階段恆為 `null`（計畫 §4.1）；第 3 層排班上線後改傳真正的班表 id。 */
  readonly employeeScheduleId: string | null
  readonly workDate: string
  readonly scheduledMinutes: number
  readonly workedMinutes: number
  readonly lateMinutes: number
  readonly earlyLeaveMinutes: number
  readonly absenceMinutes: number
  readonly leaveMinutes: number
  readonly overtimeMinutes: number
  readonly resultStatusCode: AttendanceResultStatusCodeValue
  /** 這次計算時間；命中既有列時同步覆蓋成最新一次計算時間（見下方 `set`）。 */
  readonly calculatedAt: string
  readonly updatedAt: string
}

/** 空陣列直接略過——`INSERT ... VALUES ()` 不是合法語句，且「沒有東西要寫」本來就該什麼都不做。 */
export const upsertAttendanceResults = async (
  runner: QueryRunner,
  companyId: string,
  rows: readonly UpsertAttendanceResultRow[],
): Promise<void> => {
  if (rows.length === 0) return

  await runner
    .insert(attendanceResults)
    .values(
      rows.map((row) => ({
        id: row.id,
        companyId,
        employeeId: row.employeeId,
        employeeScheduleId: row.employeeScheduleId,
        workDate: row.workDate,
        scheduledMinutes: row.scheduledMinutes,
        workedMinutes: row.workedMinutes,
        lateMinutes: row.lateMinutes,
        earlyLeaveMinutes: row.earlyLeaveMinutes,
        absenceMinutes: row.absenceMinutes,
        leaveMinutes: row.leaveMinutes,
        overtimeMinutes: row.overtimeMinutes,
        resultStatusCode: row.resultStatusCode,
        calculatedAt: row.calculatedAt,
        updatedAt: row.updatedAt,
      })),
    )
    .onDuplicateKeyUpdate({
      set: {
        // `id`／`companyId`／`employeeId`／`workDate` 不在這裡：它們是唯一鍵或推導自唯一鍵，
        // 命中既有列時必須維持原值（尤其 `id`——重算不得讓既有判定結果的識別碼跟著換掉）。
        // `employeeScheduleId` 需要能被更新：排班上線後同一天重算，這一欄要能從 `null` 換成
        // 真正的班表 id。`VALUES(col)` 取的是這次嘗試寫入的新值，MariaDB 未棄用此語法
        // （MySQL 8.0.20 起棄用，但本站是 MariaDB，見 `sundial-backend` skill 的技術棧）。
        employeeScheduleId: sql`values(${attendanceResults.employeeScheduleId})`,
        scheduledMinutes: sql`values(${attendanceResults.scheduledMinutes})`,
        workedMinutes: sql`values(${attendanceResults.workedMinutes})`,
        lateMinutes: sql`values(${attendanceResults.lateMinutes})`,
        earlyLeaveMinutes: sql`values(${attendanceResults.earlyLeaveMinutes})`,
        absenceMinutes: sql`values(${attendanceResults.absenceMinutes})`,
        leaveMinutes: sql`values(${attendanceResults.leaveMinutes})`,
        overtimeMinutes: sql`values(${attendanceResults.overtimeMinutes})`,
        resultStatusCode: sql`values(${attendanceResults.resultStatusCode})`,
        calculatedAt: sql`values(${attendanceResults.calculatedAt})`,
        updatedAt: sql`values(${attendanceResults.updatedAt})`,
      },
    })
}
