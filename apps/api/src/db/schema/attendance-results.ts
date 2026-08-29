/**
 * `attendance_results`：依班表、有效打卡、請假與異動計算的遲到、早退、缺卡等判定結果（資料字典
 * `03-scheduling-attendance.md`「出勤 Schema」`attendance_results` 節；實作計畫
 * `plans/06-attendance.md` §4.1、§5 Stage 4）。**不得反向改寫原始打卡或班表**——本表只保存
 * 計算後的判定快照。
 *
 * **與資料字典不同之處，逐項說明：**
 *
 * 1. **新增 `company_id` 欄位，字典的欄位清單裡沒有它。** 這是本計畫依「多公司資料隔離最高優先」
 *    （`sundial-backend` skill §2）新增的必要基礎欄位，不是隨手加的：`TenantDatabase`
 *    （`db/client.ts`）只接受帶 `company_id` 的表，沒有它就寫不出一支安全的公司範圍查詢或批次
 *    重算（計畫 §4.1 的批次動作要依公司範圍掃 `NO_SCHEDULE` 紀錄）。字典的其餘四張出勤表
 *    （`attendance_settings`／`attendance_records`／`attendance_correction_requests`／
 *    `attendance_correction_reviews`）字面上都有或後續定案為有 `company_id`，這一張沒有列出來
 *    比較像是字典編寫時的遺漏，不是刻意設計成全域表——`attendance_results` 顯然是公司範圍的資料
 *    （出勤判定天生依附在某間公司的員工與規則之下）。
 * 2. **`employee_schedule_id` 只有欄位，沒有 `NOT NULL`，也沒有外鍵約束。** 字典標記「必填」，
 *    但 `employee_schedules`（第 3 層排班）現在還不存在——指向不存在的表寫不出 FK；更關鍵的是，
 *    本階段（Stage 4）只做「無班表判定」，`computeAttendanceResult` 收到的 `schedule` 恆為
 *    `null`（見 `modules/attendance/results/domain/attendance-result-model.ts` 的 {@link Schedule}
 *    型別檔頭），因此這一欄在本階段**恆為 `null`**，字典「必填」這件事在排班（第 3 層）真正
 *    存在、`Schedule` 有真實值可以指出「這次判定依哪一筆班表」之前，本來就填不出來——這不是
 *    遺漏，是誠實的階段性缺口，比照 `db/schema/attendance-records.ts` 檔頭第 2 點同一種處理。
 * 3. **沒有 `employment_id`。** 字典的欄位清單本來就沒有列這一欄（不像 `attendance_records`
 *    同時列了 `employee_id`／`employment_id` 兩欄），計畫 §9「字典已定案，本計畫照抄」把
 *    `attendance_results` 全部欄位列入照抄範圍，這裡逐欄照抄，不額外新增。自然結果是：
 *    一位員工同一個工作日只有一筆判定結果（不像 `attendance_records` 可能因為離職再回任而
 *    分屬兩段任職），這與「一天只有一組有效上下班卡」（`attendance_records` 的
 *    `revoked_seq` 唯一鍵）在語意上是一致的。
 *
 * **唯一鍵 `(company_id, employee_id, work_date)`**：這是判定結果的自然身分——同一員工同一
 * 工作日只會有一筆現行判定，重算是「原地覆蓋」而不是「再插一筆」。批次與單筆重算都靠這把鍵做
 * `INSERT ... ON DUPLICATE KEY UPDATE`（見 `modules/attendance/results/impl/
 * attendance-results.upsert.repository.ts` 檔頭），因此這裡不是單純「防重複」，是重算機制能不能
 * 用一次語句同時涵蓋「這天第一次有判定」與「這天重算」兩種情況的關鍵。
 */
import { char, date, datetime, foreignKey, index, int, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employees } from './employees.ts'

/**
 * 出勤判定狀態代碼。**字典沒有列舉值，這是本計畫自行決定的**（比照 `attendance-records.ts` 的
 * `AttendanceTypeCode`／`AttendanceSourceTypeCode` 同一種處理）。
 *
 * **本階段只定義 `NoSchedule` 一項。** 字典原文「`result_status_code` 新增 `NO_SCHEDULE`，
 * 與『正常』『遲到』『異常』等既有狀態並列」暗示了其餘狀態的存在，但那些狀態依賴對照班表的判定
 * 邏輯（遲到／早退門檻怎麼算），而那段邏輯排在第 3 層排班上線之後才實作（計畫 §8「對照班表的
 * 出勤判定……排在排班上線之後」）。現在就把「正常」「遲到」「異常」的代碼值定下來，會是沒有任何
 * 程式碼路徑會產生、也無從驗證對不對的臆測值——比照計畫 §8 對 `overtime_minutes`／
 * `leave_minutes`「不做提前猜測」的同一個判斷，這裡的代碼值同樣不做提前猜測，等第 3 層真正
 * 實作對照班表分支時再補。
 */
export const AttendanceResultStatusCode = {
  /** 沒有班表可供比對；排班（第 3 層）上線前，這是唯一會被寫入的狀態。 */
  NoSchedule: 1,
} as const

export type AttendanceResultStatusCodeValue =
  (typeof AttendanceResultStatusCode)[keyof typeof AttendanceResultStatusCode]

export const attendanceResults = mysqlTable(
  'attendance_results',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 所屬公司外鍵。**與資料字典不同：新增欄位**，理由見檔頭第 1 點。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    /**
     * FK → `employee_schedules.id`（第 3 層排班，尚未實作）。**與資料字典不同：字典標必填，
     * 這裡選填、且沒有 FK 約束**，理由見檔頭第 2 點——本階段 `computeAttendanceResult` 收到的
     * `schedule` 恆為 `null`，這一欄恆為 `null`；排班上線時補上外鍵與真正的值，不需要更動這裡
     * 的表結構之外的東西。
     */
    employeeScheduleId: char('employee_schedule_id', { length: 36 }),
    /** 班次工作日期，不以跨日打卡的日曆日期取代（字典原文）——與 `attendance_records.work_date`
     * 同一套「由配對決定」的歸屬規則，見 `modules/attendance/results/domain/
     * attendance-result-engine.ts` 檔頭。 */
    workDate: date('work_date', { mode: 'string' }).notNull(),
    /** 應工作分鐘數。無班表時固定 `0`（計畫 §4.1）。 */
    scheduledMinutes: int('scheduled_minutes').notNull(),
    /** 實際工作分鐘數。唯一在無班表時仍算得出來的欄位——配對到的有效上下班卡時間差。 */
    workedMinutes: int('worked_minutes').notNull(),
    /** 遲到分鐘數。無班表時固定 `0`。 */
    lateMinutes: int('late_minutes').notNull(),
    /** 早退分鐘數。無班表時固定 `0`。 */
    earlyLeaveMinutes: int('early_leave_minutes').notNull(),
    /** 缺勤分鐘數。無班表時固定 `0`——連「這天該不該上班」都不知道，談不上缺勤。 */
    absenceMinutes: int('absence_minutes').notNull(),
    /** 核准請假分鐘數。第 4 層請假模組尚未實作，本階段固定 `0`（計畫 §8）。 */
    leaveMinutes: int('leave_minutes').notNull(),
    /** 認列加班分鐘數。第 4 層加班模組尚未實作，本階段固定 `0`（計畫 §8）。 */
    overtimeMinutes: int('overtime_minutes').notNull(),
    /** 出勤判定狀態代碼，見 {@link AttendanceResultStatusCode}。 */
    resultStatusCode: int('result_status_code').$type<AttendanceResultStatusCodeValue>().notNull(),
    /** 這一筆判定第一次算出來的時間；重算時同步更新為最新一次計算時間。 */
    calculatedAt: datetime('calculated_at', { mode: 'string' }).notNull(),
    /** 最後重算時間。首次寫入時與 `calculatedAt` 相同。 */
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 判定結果的自然身分，見檔頭「唯一鍵」說明。以 `company_id` 開頭同時滿足 §4.5
     * 「帶 company_id 的表，索引必須以它開頭」。
     */
    uniqueIndex('uq_attendance_results_company_employee_work_date').on(
      table.companyId,
      table.employeeId,
      table.workDate,
    ),
    /**
     * 批次重算（「重算全部 `NO_SCHEDULE` 紀錄」，計畫 §4.1、§5 Stage 4）的查詢路徑：依公司範圍
     * 掃描目前狀態為 `NO_SCHEDULE` 的紀錄。以 `company_id` 開頭滿足 §4.5。
     */
    index('ix_attendance_results_company_status').on(table.companyId, table.resultStatusCode),
    foreignKey({
      name: 'fk_attendance_results_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接：本表的 `company_id` 必須與 `employee_id` 所屬公司一致。 */
    foreignKey({
      name: 'fk_attendance_results_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
  ],
)
