/**
 * `shift_work_periods`：班別的工作時段，一天可多段，用以表達跨日班、分段班與中空班
 * （資料字典 `03-scheduling-attendance.md`「排班 Schema」；實作計畫 `plans/04-shift-definitions.md` §5.2）。
 *
 * **本表不進 `CompanyScopedTable`**（`db/schema/index.ts`，計畫 §5.2）：本表沒有 `company_id`
 * 欄位，公司範圍由 `shift_definition_id` 間接決定。存取一律經由 `shift_definitions` 的 service，
 * 不單獨開端點，因此不需要（也不該）讓 `TenantDatabase` 對它強制公司條件——那個條件在資料上
 * 根本不存在，強加只會讓查詢寫不出來。
 *
 * **約束（本輪只做資料庫層，§5.2 其餘規則留給 Stage 2 的 service）**：
 * - `UNIQUE(shift_definition_id, sequence_no)` 由本檔的唯一索引保證。
 * - 工作時段不得重疊、`work_minutes` 必須等於起訖時間之差（含日偏移，由 service 計算，
 *   不由呼叫端送）——這兩條是業務規則，不是資料庫約束能表達的形狀，本表不處理。
 */
import { char, foreignKey, int, mysqlTable, time, uniqueIndex } from 'drizzle-orm/mysql-core'
import { shiftDefinitions } from './shift-definitions.ts'

export const shiftWorkPeriods = mysqlTable(
  'shift_work_periods',
  {
    /**
     * 資料字典標記「型態待恢復」，比照全站慣例採用 uuid（`char(36)`）——本站所有具業務意義的
     * 主鍵除法規三表與 `company_regulatory_settings`（`bigint` auto-increment）外一律是 uuid，
     * 本表沒有理由是那個例外。
     */
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `shift_definitions.id`（見下方 `fk_shift_work_periods_shift_definition`）。 */
    shiftDefinitionId: char('shift_definition_id', { length: 36 }).notNull(),
    /** 同一班別內工作時段的順序，從 1 開始（由呼叫端／service 指定，不是資料庫自動編號）。 */
    sequenceNo: int('sequence_no').notNull(),
    /** 工作時段開始時間，台北時間、不帶日期（後端規範 §6.1：不含日期的時刻）。 */
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /**
     * 結束日相對於開始日的偏移；跨日班用 1。與 `shift_breaks` 的日偏移欄位同一機制
     * （計畫 §4.2），用來分辨「這個時刻是開始前還是開始後」。
     */
    endDayOffset: int('end_day_offset').notNull(),
    /**
     * 此工作時段應工作分鐘數。**由 service 計算，不由呼叫端送**（計畫 §5.2）：必須等於
     * 起訖時間之差（含 `end_day_offset`），送進來的值與算出來的值若不一致，處置沒有標準答案，
     * 因此乾脆不收——理由與 `shift_definitions.required_work_minutes` 是同一件事（計畫 §4.1）。
     */
    workMinutes: int('work_minutes').notNull(),
  },
  (table) => [
    uniqueIndex('uq_shift_work_periods_shift_sequence').on(table.shiftDefinitionId, table.sequenceNo),
    /**
     * 單欄 FK（不是複合外鍵）：本表沒有 `company_id`，沒有「跨公司指錯」這個破口可堵——
     * 只要 `shift_definition_id` 指得到一筆存在的 `shift_definitions`，公司範圍自然就是那一筆的
     * `company_id`，不需要（也無法）在這裡再約束一次。
     */
    foreignKey({
      name: 'fk_shift_work_periods_shift_definition',
      columns: [table.shiftDefinitionId],
      foreignColumns: [shiftDefinitions.id],
    }),
  ],
)
