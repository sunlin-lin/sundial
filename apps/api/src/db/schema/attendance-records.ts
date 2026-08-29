/**
 * `attendance_records`：正常或核准補登形成的正式打卡事件（資料字典 `03-scheduling-attendance.md`
 * 「出勤 Schema」`attendance_records` 節，含「打卡欄位定案」節；實作計畫 `plans/06-attendance.md`
 * §4.2～§4.6、§5 Stage 3）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **座標與反查地址為明文欄位，不是 `*_encrypted`。** 字典「打卡欄位定案」節舊版曾比照
 *    `employees` 的加密欄位規畫 `latitude_encrypted`／`longitude_encrypted`／`address_encrypted`，
 *    但 `docs/dev-standards-backend.md` §5.1 已把敏感個資的加密責任整個搬到資料庫端靜態加密
 *    （`innodb_encrypt_tables`，全站尚未啟用），應用層加密因此整組拿掉，這裡直接是明文欄位
 *    `latitude`／`longitude`／`address`。計畫 §4.2 有完整推論：座標不加總、不做門檻比較，
 *    IEEE754 誤差比 GPS 定位裝置本身的公尺級誤差小六個數量級，不落在「金額禁止 number」的判準裡；
 *    因此 DB 端仍用 `decimal` 定點儲存（避免寫入當下的二進位捨入疑慮），但 API 回應可以直接是
 *    JSON `number`，不必比照金額全程以字串流通。
 * 2. **`employee_schedule_id`／`source_id` 只有欄位，沒有外鍵約束。** 兩欄字典上分別指向
 *    `employee_schedules`／`attendance_correction_requests`，但這兩張表在本階段（Stage 3）都
 *    還不存在——`employee_schedules` 屬於排班模組（尚未動工），`attendance_correction_requests`
 *    排在本計畫 Stage 8。指向不存在的表寫不出 FK，這裡先保留欄位本身（兩者皆選填，Stage 3 的
 *    五個動作也從不寫入非 `null` 值），等對應模組落地時再回來補上外鍵——這是誠實的階段性缺口，
 *    不是遺漏。
 *
 * **併發鎖粒度＝`employee_employments`，不是本表自己**（計畫 §4.5）：寫入前對「今天這張卡」
 * 根本沒有任何一列可鎖，鎖一張保證存在的任職主檔列才可預期。完整理由與鎖定順序見
 * `modules/attendance/records/impl/attendance-records.find-employment-for-update.repository.ts`。
 *
 * **`revoked_seq` 的唯一鍵**：`UNIQUE(employee_id, work_date, attendance_type_code, revoked_seq)`，
 * 有效紀錄恆為 `0`。MariaDB 的唯一索引中 NULL 互不相等，若唯一鍵不含 `revoked_seq`，撤銷後同一天
 * 同一種卡就補不了卡——作法與 `employees.deleted_seq` 相同。
 *
 * **本人撤銷與他人撤銷共用同一組 `revoked_*` 欄位，不另加 `deleted_at`／`deleted_seq`**
 * （使用者 2026-08-29 已確認，計畫 §4.3.1 選項 A）：這張表的失效機制從一開始就只設計了一種
 * 「這筆記錄不算數了」的狀態，只是命名沿用「撤銷」而不是「刪除」。事後要分辨是本人撤銷還是
 * 他人撤銷，比較 `revoked_by` 是否等於這筆記錄 `employee_id` 目前綁定的 `company_users` 帳號
 * 即可，不需要另外存欄位區分。
 */
import {
  bigint,
  char,
  date,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { companyUsers } from './company-users.ts'
import { employeeEmployments } from './employee-employments.ts'
import { employees } from './employees.ts'

/**
 * 打卡事件類型。**不用 DB ENUM**（通用規範 §1.4）。
 *
 * 字典只寫「打卡事件類型」沒有列舉值，這兩個值是本次自行決定的，僅表達「上班／下班」這一個
 * 二元事實（計畫 §4.5：先做出配對用的一般查詢會踩到 REPEATABLE READ 的坑，因此只需要兩種卡）。
 */
export const AttendanceTypeCode = {
  ClockIn: 1,
  ClockOut: 2,
} as const

export type AttendanceTypeCodeValue = (typeof AttendanceTypeCode)[keyof typeof AttendanceTypeCode]

/**
 * 打卡來源類型。字典「打卡來源類型，例如現場打卡或人工補登」，這兩個值同樣是本次自行決定的。
 *
 * `ManualCorrection` 本階段（Stage 3）沒有任何一個動作會寫入——補打卡申請核准後建立正式打卡
 * 排在 Stage 8，這裡先把代碼定下來，供 Stage 8 直接沿用，不必屆時再回頭改這張表。
 */
export const AttendanceSourceTypeCode = {
  Field: 1,
  ManualCorrection: 2,
} as const

export type AttendanceSourceTypeCodeValue = (typeof AttendanceSourceTypeCode)[keyof typeof AttendanceSourceTypeCode]

export const attendanceRecords = mysqlTable(
  'attendance_records',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 所屬公司外鍵；全域規則要求 Tenant 資料可追溯至公司，撤銷者的複合外鍵也需要它。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /**
     * 員工外鍵，**查詢便利欄位，不是歸屬單位**（計畫 §4.4）：「我的出勤紀錄」要跨這個人目前的
     * 任職查，全體出勤列表用員工編號／姓名搜尋走的也是這條線，不是先查任職再查出勤。
     */
    employeeId: char('employee_id', { length: 36 }).notNull(),
    /**
     * 任職紀錄外鍵，**出勤紀錄實際的歸屬單位**（計畫 §4.4）：離職再回任會建立第二筆
     * `employee_employments`，兩段任職各自的出勤紀錄天然分開靠這一欄必填保證，不需要額外設計。
     */
    employmentId: char('employment_id', { length: 36 }).notNull(),
    /** 欄位已確認；代碼值或額外約束未在定案節點明定。見檔頭第 2 點：目標表尚未落地，沒有 FK。 */
    employeeScheduleId: char('employee_schedule_id', { length: 36 }),
    /**
     * **由配對決定，不是「打卡當日」**（字典「打卡欄位定案」節）：下班卡的 `work_date` 取自它要
     * 配對的那張有效上班卡；找不到可配對的上班卡時才退回打卡當日。反過來寫（以打卡當日為準）
     * 會讓跨日班永遠配不起來（22:00 上班、05:50 下班分屬不同工作日）。
     */
    workDate: date('work_date', { mode: 'string' }).notNull(),
    attendanceTypeCode: int('attendance_type_code').$type<AttendanceTypeCodeValue>().notNull(),
    /** 打卡來源類型，例如現場打卡或人工補登。 */
    sourceTypeCode: int('source_type_code').$type<AttendanceSourceTypeCodeValue>().notNull(),
    /** 人工補登時 FK → `attendance_correction_requests.id`。見檔頭第 2 點：目標表尚未落地，沒有 FK。 */
    sourceId: char('source_id', { length: 36 }),
    /** 打卡時刻（台北牆鐘）。 */
    clockedAt: datetime('clocked_at', { mode: 'string' }).notNull(),
    /**
     * 緯度（十進位度數，±90，小數 7 位約 1.1 公分精度）。**明文欄位**，機密性交由資料庫端靜態
     * 加密負責（見檔頭第 1 點）。選填：`gps_required=false` 時本來就可能沒收到座標。
     */
    latitude: decimal('latitude', { precision: 9, scale: 7, mode: 'string' }),
    /** 經度（十進位度數，±180）。見 `latitude` 註解。 */
    longitude: decimal('longitude', { precision: 10, scale: 7, mode: 'string' }),
    /** 定位精準度（公尺）；非個資——知道「這次定位誤差 5 公尺」不會讓人知道人在哪裡。 */
    accuracyMeters: int('accuracy_meters'),
    /** 反查地址。 */
    address: varchar('address', { length: 255 }),
    /**
     * 反查完成時刻；`NULL` 表示尚未反查或反查失敗。**打卡不得因反查失敗而失敗**——打卡當下只寫
     * 入座標，這兩欄由背景服務非同步補上（背景反查服務本身不在 Stage 3 範圍內，這兩欄在本階段
     * 因此恆為 `NULL`，是誠實的階段性缺口）。
     */
    addressResolvedAt: datetime('address_resolved_at', { mode: 'string' }),
    /** 撤銷時刻；`NULL` 代表這筆記錄有效（「有效狀態」不另設欄位，見下方唯一鍵註解）。 */
    revokedAt: datetime('revoked_at', { mode: 'string' }),
    /** 撤銷者公司成員；複合外鍵 `(company_id, revoked_by)`。 */
    revokedBy: char('revoked_by', { length: 36 }),
    /** 撤銷原因；撤銷時必填（由 service 層驗證，見 §4.3.1 兩支撤銷端點）。 */
    revokeReason: text('revoke_reason'),
    /**
     * 撤銷流水號，有效紀錄恆為 `0`；見下方唯一鍵。作法與 `employees.deleted_seq` 相同
     * （字典「打卡欄位定案」節原文）。
     */
    revokedSeq: bigint('revoked_seq', { mode: 'number' }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 「同一員工、同一工作日、同一類型只能有一張有效卡」——見檔頭「`revoked_seq` 的唯一鍵」。
     * 同時是 `create` 動作在唯一鍵層級的最後一道保險（計畫 §4.5：鎖之外的邊界情況擋不住的交給
     * 唯一鍵擋）。
     */
    uniqueIndex('uq_attendance_records_employee_work_date_type_seq').on(
      table.employeeId,
      table.workDate,
      table.attendanceTypeCode,
      table.revokedSeq,
    ),
    /**
     * `list-by-date`（依日期查全公司打卡）的主要查詢路徑，§4.5 要求以 `company_id` 開頭
     * ——沒有這支索引，全公司規模的「某一天」查詢會退化成全表掃描。
     */
    index('ix_attendance_records_company_work_date').on(table.companyId, table.workDate),
    /**
     * 打卡建立時的配對／重複檢查路徑：鎖到 `employee_employments` 之後，查「這筆任職目前有效的
     * 同類型打卡」（`find-punch.repository.ts`）。以 `company_id` 開頭滿足 §4.5；
     * 涵蓋 `employment_id`／`attendance_type_code`／`revoked_seq` 三個等值條件，`work_date` 放在
     * 最後一欄——重複檢查用它做等值比對，配對查詢用它做 `ORDER BY ... DESC LIMIT 1`，
     * 兩者都吃得到這支索引，不必再另外掃描。
     */
    index('ix_attendance_records_company_employment_type_seq').on(
      table.companyId,
      table.employmentId,
      table.attendanceTypeCode,
      table.revokedSeq,
      table.workDate,
    ),
    /**
     * `revoked_by` 的支撐索引，理由與 `company_user_roles` 的同類索引同構（見該檔檔頭）：
     * 沒有它，InnoDB 會自動補一個不以 `company_id` 開頭的索引，那是 §4.5 擋不到、review 也看
     * 不見的洞。
     */
    index('ix_attendance_records_company_revoked_by').on(table.companyId, table.revokedBy),
    foreignKey({
      name: 'fk_attendance_records_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接：本表的 `company_id` 必須與 `employee_id` 所屬公司一致。 */
    foreignKey({
      name: 'fk_attendance_records_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
    /** 防止跨公司掛接：本表的 `company_id` 必須與 `employment_id` 所屬公司一致。 */
    foreignKey({
      name: 'fk_attendance_records_employment',
      columns: [table.companyId, table.employmentId],
      foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
    }),
    /** 撤銷者必須真的是本公司的一位成員（理由與 `company_user_roles.revoked_by` 同構）。 */
    foreignKey({
      name: 'fk_attendance_records_revoked_by',
      columns: [table.companyId, table.revokedBy],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
  ],
)
