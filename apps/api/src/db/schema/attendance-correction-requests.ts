/**
 * `attendance_correction_requests`：忘打卡補登申請，上班與下班分開申請（資料字典
 * `03-scheduling-attendance.md`「出勤 Schema」`attendance_correction_requests` 節；實作計畫
 * `plans/06-attendance.md` §4.6、§9、§5 Stage 8）。**本輪只做員工端**（提交、查詢自己的申請、
 * 撤回）；核准／退回／撤銷核准／撤銷退回排在 Stage 9（`attendance_correction_reviews`）。
 *
 * **與資料字典不同之處，逐項說明：**
 *
 * 1. **新增 `company_id` 欄位，字典的欄位清單裡沒有它。** 與 `db/schema/attendance-results.ts`
 *    檔頭第 1 點同一種情況：`TenantDatabase`（`db/client.ts`）只接受帶 `company_id` 的表，沒有它
 *    就寫不出一支安全的公司範圍查詢。字典其餘出勤表都字面上有或後續定案為有 `company_id`，這一張
 *    沒有列出來比較像是編寫時的遺漏，不是刻意設計成全域表——補打卡申請顯然是公司範圍的資料。
 * 2. **新增 `work_date` 欄位，字典的欄位清單裡也沒有它。** 字典把「補卡工作日期」表達成
 *    `employee_schedule_id`（FK → `employee_schedules.id`），意思是這一欄本來要靠排班（第 3 層）
 *    間接指出是哪一個工作日；但 `employee_schedules` 現在還不存在（見下一點），指向它拿不到
 *    `schedule_date`。沒有一個直接的日期欄位，這張表就連「同一工作日、同一類型不得同時存在多筆
 *    待審核申請」（字典「已確認流程與約束」）這條唯一鍵都表達不出來，也做不了 UI 13「已有效打卡
 *    的類型不可重複申請」「不可選擇未來日期」這些檢查——這些規則全部要拿「補卡的是哪一天」當比較
 *    基準。因此本表新增這一欄，用法與 `attendance_records.work_date` 相同（員工申請時選定的
 *    工作日），排班上線、`employee_schedule_id` 真的能指到一筆班表之後，兩者應該互相對得上，
 *    但這一欄不因此變成多餘：它是這張表在排班存在之前唯一能確定「補卡日期」的來源。
 * 3. **`employee_schedule_id` 只有欄位，沒有 `NOT NULL`，也沒有外鍵約束。** 字典標記「必填」，
 *    但 `employee_schedules`（第 3 層排班）現在還不存在——指向不存在的表寫不出 FK。這一欄在本階段
 *    恆為 `null`，比照 `db/schema/attendance-records.ts` 檔頭第 2 點同一種處理：不是遺漏，是誠實
 *    的階段性缺口，排班上線後才填得出真正的值。
 *
 * **`id`／`employee_id`／`employment_id`／`reason`／`status_code` 這五欄，字典標「型態待恢復」／
 * 「待核對」。** 計畫 §9 已定案：這些欄位的性質（uuid 主鍵、必填外鍵）與 `attendance_records` 逐字
 * 一致，直接套用同一套型別，不是需要另外拍板的開放問題——`id` 用 `char(36)` uuid 主鍵；
 * `employee_id`／`employment_id` 用 `char(36)` uuid 必填外鍵；`reason` 用 `text` 必填（UI 13「申請
 * 原因：必填」，比照 `attendance_records.revoke_reason` 的型態，但那裡是撤銷時才必填、這裡是
 * 建立時就必填，因此本表的 `reason` 直接宣告 `notNull()`）；`status_code` 用 `int` 必填
 * （見下方 {@link AttendanceCorrectionRequestStatusCode}）。
 *
 * **重複申請的唯一鍵：`pending_seq`，比照 `attendance_records.revoked_seq` 的同一套手法，但語意
 * 相反。** 字典「已確認流程與約束」：「上班與下班分開申請；同一工作日、同一類型不得同時存在多筆
 * 待審核申請」——但「未核准」「已撤回」的舊申請不擋新申請（UI 13：未核准不提供複製重送，但沒說
 * 不能重新單獨申請；已撤回本來就是為了讓員工能重新提交而存在），只有「待審核」這個狀態需要互斥。
 * `revoked_seq` 用 `0` 代表「有效」、非零代表「已撤銷過，不再互斥」；這裡反過來，`pending_seq`
 * 用 `0` 代表「目前待審核，占用互斥名額」，一旦離開待審核狀態（本輪只有撤回一條路徑；Stage 9
 * 的核准／退回上線後，那兩個動作也要把這一欄改成非零，才能讓同一天同一類型的名額重新空出來，
 * 見 {@link AttendanceCorrectionRequestStatusCode} 的檔頭），就寫入一個唯一的非零值（撤回時用
 * `context.clock.epochMs()`，理由與 `revoked_seq` 相同：同一筆申請只會離開待審核狀態一次，
 * 不可能與自己碰撞）。唯一鍵是 `(employee_id, work_date, attendance_type_code, pending_seq)`。
 *
 * **唯一鍵表達得了的就不要用鎖**（`sundial-backend` skill、`attendance_settings` 的既有判準）：
 * 這裡的重複判定是「同一天同一類型只能有一筆待審核」，唯一鍵本身就能完整表達，不需要像打卡
 * 配對邏輯那樣先鎖 `employee_employments` 再讀——沒有「先讀最新一筆再決定寫哪個值」這種需要
 * 一致性讀快照的分支，直接寫入並攔截唯一鍵違反即可（`domain/
 * attendance-correction-request-duplicate.ts`）。
 */
import {
  bigint,
  char,
  date,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employeeEmployments } from './employee-employments.ts'
import { employees } from './employees.ts'
import type { AttendanceTypeCodeValue } from './attendance-records.ts'

/**
 * 申請狀態代碼。UI 13：待審核、已核准、未核准、已撤回。
 *
 * **本輪（Stage 8）只會出現 `Pending` 與 `Withdrawn` 兩種值**——核准（`Approved`）與退回
 * （`Rejected`）要等 Stage 9 的審核動作才會寫入，這裡先把四個值一起定下來，理由與
 * `db/schema/attendance-records.ts` 的 `AttendanceSourceTypeCode.ManualCorrection` 相同：
 * 先把代碼定案，Stage 9 直接沿用，不必屆時再回頭改這張表或這個常數。
 *
 * **Stage 9 上線時要記得的事**：核准／退回這兩個動作除了寫 `attendance_correction_reviews`
 * 歷程，也要把本表這一筆的 `pending_seq` 改成非零（同一支「離開待審核」的動作，理由見本檔檔頭
 * 「重複申請的唯一鍵」段落）——否則同一天同一類型的待審核名額不會釋出，員工核准／退回之後
 * 想再送一次會被這個唯一鍵誤擋。
 */
export const AttendanceCorrectionRequestStatusCode = {
  Pending: 1,
  Approved: 2,
  Rejected: 3,
  Withdrawn: 4,
} as const

export type AttendanceCorrectionRequestStatusCodeValue =
  (typeof AttendanceCorrectionRequestStatusCode)[keyof typeof AttendanceCorrectionRequestStatusCode]

export const attendanceCorrectionRequests = mysqlTable(
  'attendance_correction_requests',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 所屬公司外鍵；見檔頭第 1 點。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /** 員工外鍵。與 `attendance_records.employee_id` 同一種定位——查詢便利欄位，`employment_id`
     * 才是歸屬單位（計畫 §4.4 對 `attendance_records` 的判斷，這張表的兩欄並存方式與它逐字一致，
     * 見字典「已定案，本計畫照抄」§9）。 */
    employeeId: char('employee_id', { length: 36 }).notNull(),
    /** 任職紀錄外鍵。 */
    employmentId: char('employment_id', { length: 36 }).notNull(),
    /** 排班（第 3 層）尚未動工，這一欄目前只有欄位、沒有 `NOT NULL`、也沒有外鍵約束，恆為
     * `null`。見檔頭第 3 點。 */
    employeeScheduleId: char('employee_schedule_id', { length: 36 }),
    /** 補卡的工作日期。字典沒有這一欄，本表新增，見檔頭第 2 點。 */
    workDate: date('work_date', { mode: 'string' }).notNull(),
    /** 申請補登的上班／下班事件類型。與 `attendance_records.attendance_type_code` 共用同一套代碼
     * （`AttendanceTypeCode`），不是重新定義一套等價的常數——兩張表講的是同一個「上班或下班」的
     * 業務概念，共用可以避免代碼值日後各自漂移。 */
    attendanceTypeCode: int('attendance_type_code').$type<AttendanceTypeCodeValue>().notNull(),
    /** 申請補登的實際打卡時間（台北牆鐘）。字典曾寫作 `requested_at`，語意以 `requested_clocked_at`
     * 為準（字典本節原文）。 */
    requestedClockedAt: datetime('requested_clocked_at', { mode: 'string' }).notNull(),
    /** 申請原因。UI 13「必填」，見檔頭「型態待恢復」段落。 */
    reason: text('reason').notNull(),
    /** 流程狀態代碼，見 {@link AttendanceCorrectionRequestStatusCode}。 */
    statusCode: int('status_code').$type<AttendanceCorrectionRequestStatusCodeValue>().notNull(),
    /** 待審核互斥用的流水號，見檔頭「重複申請的唯一鍵」段落。**`bigint` 不是 `int`**：離開待審核
     * 狀態時寫入 `context.clock.epochMs()`（見 `impl/attendance-correction-requests.
     * withdraw.service.ts`），epoch 毫秒在 2026 年已經是 1.7 兆量級，超過 `int` 帶號上限
     * （約 21 億），`bigint` 才裝得下——與 `attendance_records.revoked_seq` 用同一個型別是同一個
     * 理由（該檔檔頭「作法與 `employees.deleted_seq` 相同」）。 */
    pendingSeq: bigint('pending_seq', { mode: 'number' }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /** 「同一員工、同一工作日、同一類型只能有一筆待審核申請」——見檔頭。 */
    uniqueIndex('uq_attendance_correction_requests_employee_work_date_type_seq').on(
      table.employeeId,
      table.workDate,
      table.attendanceTypeCode,
      table.pendingSeq,
    ),
    /** `list-own`（查詢自己的申請，依年月＋狀態篩選）的主要查詢路徑，以 `company_id` 開頭滿足
     * §4.5「帶 company_id 的表，索引必須以它開頭」。 */
    index('ix_attendance_correction_requests_company_employee_work_date').on(
      table.companyId,
      table.employeeId,
      table.workDate,
    ),
    foreignKey({
      name: 'fk_attendance_correction_requests_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接：本表的 `company_id` 必須與 `employee_id` 所屬公司一致。 */
    foreignKey({
      name: 'fk_attendance_correction_requests_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
    /** 防止跨公司掛接：本表的 `company_id` 必須與 `employment_id` 所屬公司一致。 */
    foreignKey({
      name: 'fk_attendance_correction_requests_employment',
      columns: [table.companyId, table.employmentId],
      foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
    }),
  ],
)
