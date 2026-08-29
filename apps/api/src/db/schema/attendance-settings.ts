/**
 * `attendance_settings`：公司打卡規則主檔（資料字典 `03-scheduling-attendance.md`
 * 「出勤 Schema」`attendance_settings` 節；實作計畫 `plans/06-attendance.md` §5 Stage 2）。
 *
 * **一間公司一筆，不是一間公司多筆——這是本表與 `shift_definitions`／`departments` 最大的差異，
 * 也是本檔與那兩張表逐欄比較後才能下的判斷，不是猜的：**
 *
 * 1. **沒有 `code`／`name`。** 字典裡任何「一間公司可以有很多筆」的表（`shift_definitions`、
 *    `schedule_rules`、`job_titles`）都有代碼與名稱，因為多筆並存時需要一個人看得懂的方式去
 *    指認「是哪一筆」。這張表整份欄位清單只有 `company_id` ＋ 六個布林開關 ＋ 時間戳，
 *    沒有任何一欄能拿來區分「這是第幾套規則」。
 * 2. **沒有 `status`／`is_active`／`effective_from`／`effective_to`。** 多筆並存的表都需要一種
 *    「目前生效的是哪一筆」的判斷依據（啟用旗標、生效區間），這張表完全沒有——沒有這些欄位，
 *    「一間公司此刻該套用哪一筆設定」這個問題在多筆的世界裡根本無法回答。
 * 3. **字典原文「公司打卡規則」用單數描述、且明講「設定只管理打卡流程，不保存每日判定結果」**
 *    ——這是一份會被其他模組整份讀取的政策物件（`gps_required`、`allow_employee_cancellation`
 *    這些開關），性質上與 `companies` 主檔上直接展開的欄位（三組地址）是同一類，只是拆成獨立
 *    表；不是像 `shift_definitions` 那樣「使用時挑一筆出來套用」的型錄。
 *
 * 因此本表的唯一鍵是 `UNIQUE(company_id)`（見下方索引），CRUD 的形狀也不是「列表＋新增」，
 * 而是「查目前設定 ＋ 更新（`attendance/settings/get`、`attendance/settings/update`）」，
 * 沒有 `list`／`create`／`delete` 端點——`modules/attendance/settings/` 檔頭有完整說明。
 *
 * **沒有 `deleted_at`／`deleted_seq`。** 軟刪除是為了「刪除後同一個識別鍵可以重新使用」
 * （`employees.deleted_seq` 的先例），但這張表的識別鍵是 `company_id` 本身——公司只要還在，
 * 它的出勤設定就該一直存在（沒有設定就回 `null`，見 `get` 端點），不存在「刪除這筆設定、
 * 之後同一間公司再建一筆新的」這種情境；公司本身被刪除時，這一列跟著
 * `companyScopedTablesInDeleteOrder` 一起清空即可（`db/schema/index.ts`）。
 *
 * **「還沒有設定」查詢回 `null`，不是回一組預設值**（實作計畫已定案）：`get` 誠實回報「這間公司
 * 是否已經存過設定」，`null` 與「已存在、且六個開關剛好都是預設值」在資料上是兩種不同的狀態，
 * 混成同一個回應會讓兩者永遠分不出來。呼叫端如果需要「沒有設定時的預設行為」，屬於消費端
 * （Stage 3 起的打卡／撤銷／補打卡流程）自己的判斷，不在這張表或這個模組的職責內。
 */
import { boolean, char, datetime, foreignKey, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'

export const attendanceSettings = mysqlTable(
  'attendance_settings',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `companies.id`（見下方 `fk_attendance_settings_company`）。同時是本表的唯一鍵。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /** 是否要求有效上班卡後才能打下班卡；字典「本次需求為 true」。 */
    requireClockInBeforeClockOut: boolean('require_clock_in_before_clock_out').notNull(),
    /** 是否允許員工自行撤銷誤打紀錄；撤銷不得 DELETE（字典「打卡欄位定案」節）。 */
    allowEmployeeCancellation: boolean('allow_employee_cancellation').notNull(),
    /** 是否允許申請補登。 */
    allowCorrectionRequest: boolean('allow_correction_request').notNull(),
    /** 補登是否需審核；通過後才建立正式打卡。 */
    correctionRequiresApproval: boolean('correction_requires_approval').notNull(),
    /** 是否接受 GPS 資訊。 */
    gpsEnabled: boolean('gps_enabled').notNull(),
    /**
     * GPS 是否強制；字典「本次定案為 false」。**GPS 開啟不等於強制，缺少 GPS 不得直接判定異常**
     * ——這條規則本身在 Stage 2 沒有程式碼可以違反（本階段不做打卡），留給 Stage 3 打卡動作遵守。
     */
    gpsRequired: boolean('gps_required').notNull(),
    // datetime 一律 mode: 'string'，存的就是台北牆鐘時間，不做任何換算（§6）。
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 一間公司一筆的唯一保證，也是「先讀後寫」以外唯一真正擋住併發第一次寫入的機制
     * （見 `modules/attendance/settings/impl/attendance-settings.update.service.ts` 檔頭）。
     * 索引以 `company_id` 開頭，同時滿足 §4.5「帶 company_id 的表，索引必須以它開頭」。
     */
    uniqueIndex('uq_attendance_settings_company_id').on(table.companyId),
    foreignKey({
      name: 'fk_attendance_settings_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
  ],
)
