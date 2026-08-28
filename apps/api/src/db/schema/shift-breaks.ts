/**
 * `shift_breaks`：班別的休息時段，可多段、分有薪無薪
 * （資料字典 `03-scheduling-attendance.md`「排班 Schema」；實作計畫 `plans/04-shift-definitions.md` §4.2、§5.2）。
 *
 * **與資料字典不同：新增 `start_day_offset` 與 `end_day_offset` 兩欄（計畫對資料字典的唯一增補）。**
 *
 * 字典原本只有 `start_time`／`end_time`，`shift_work_periods` 有 `end_day_offset` 但本表沒有。
 * 具體情境：22:00–06:00 的夜班休息 02:00–03:00，`start_time` 存 `02:00`——**這個 02:00 是班次
 * 開始前二十小時，還是開始後四小時？** 從欄位上分不出來，兩種讀法對出勤判定會算出完全不同的
 * 分鐘數。字典明列跨日班與多段休息都在範圍內，所以這不是「用不到」，是**欄位不足**。
 *
 * 為什麼不能靠「休息一定落在某個工作時段內」反推：中空班的兩段工作之間本來就有空檔，
 * 那個空檔可能跨過午夜，反推需要一串條件判斷，而條件判斷寫錯不會報錯——不如直接存下來。
 *
 * **本表不進 `CompanyScopedTable`**，理由與 `shift_work_periods` 相同：沒有 `company_id`，
 * 公司範圍由 `shift_definition_id` 間接決定，存取一律經由 `shift_definitions` 的 service。
 */
import { boolean, char, foreignKey, int, mysqlTable, time, uniqueIndex } from 'drizzle-orm/mysql-core'
import { shiftDefinitions } from './shift-definitions.ts'

export const shiftBreaks = mysqlTable(
  'shift_breaks',
  {
    /** 型態決定理由同 `shift_work_periods.id`：字典標記「型態待恢復」，比照全站慣例採用 uuid。 */
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `shift_definitions.id`（見下方 `fk_shift_breaks_shift_definition`）。 */
    shiftDefinitionId: char('shift_definition_id', { length: 36 }).notNull(),
    /** 同一班別內休息時段的順序，從 1 開始（由呼叫端／service 指定，不是資料庫自動編號）。 */
    sequenceNo: int('sequence_no').notNull(),
    /** 休息開始時間，台北時間、不帶日期（後端規範 §6.1）。 */
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /**
     * **與資料字典不同：新增欄位（本檔檔頭已詳述理由）。** 開始時刻相對於班次開始日的日偏移。
     */
    startDayOffset: int('start_day_offset').notNull(),
    /** **與資料字典不同：新增欄位。** 結束時刻相對於班次開始日的日偏移，與 `shift_work_periods.end_day_offset` 同一機制。 */
    endDayOffset: int('end_day_offset').notNull(),
    /**
     * 休息分鐘數。**由 service 計算，不由呼叫端送**：必須等於起訖時間之差（含日偏移），
     * 理由與 `shift_work_periods.work_minutes` 是同一件事（計畫 §4.1、§5.2）。
     */
    breakMinutes: int('break_minutes').notNull(),
    /** 是否為有薪休息；無薪休息會從 `shift_definitions.required_work_minutes` 中扣除（計畫 §4.1）。 */
    isPaid: boolean('is_paid').notNull(),
  },
  (table) => [
    uniqueIndex('uq_shift_breaks_shift_sequence').on(table.shiftDefinitionId, table.sequenceNo),
    /** 單欄 FK，理由同 `shift_work_periods`：本表沒有 `company_id`，沒有跨公司指錯這個破口可堵。 */
    foreignKey({
      name: 'fk_shift_breaks_shift_definition',
      columns: [table.shiftDefinitionId],
      foreignColumns: [shiftDefinitions.id],
    }),
  ],
)
