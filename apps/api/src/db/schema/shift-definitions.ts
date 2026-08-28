/**
 * `shift_definitions`：班別主檔，定義「一天怎麼上班」——幾點到幾點、休息幾段、跨不跨日、
 * 應工作幾分鐘（資料字典 `03-scheduling-attendance.md`「排班 Schema」；實作計畫 `plans/04-shift-definitions.md`）。
 *
 * **本表只回答「班怎麼排」，與「誰上這個班」完全無關。** 排班（誰在哪天上哪個班）依賴
 * `employee_employments`，那張表現在還不存在（計畫 §2），因此本輪只做班別主檔與其兩張子表，
 * 不做排班本身。
 *
 * **「班別被引用後不得覆蓋歷史」這條規則，本輪刻意不實作**（計畫 §7，資料字典明文定案的規則）。
 * 沒有任何表引用 `shift_definitions`——排班那幾張表都還不存在——所以「這個班別被引用了嗎」
 * 這個查詢的答案恆為否。寫一個永遠回 `false` 的檢查比不寫更糟：它看起來守著一條規則，
 * 實際上一次都擋不到東西，而下一個人會**假設它有效**。
 *
 * **這是一筆必須被接住的欠帳，不是被遺忘的事**：排班模組動工的第一件事就是補上這道防護，
 * 否則排班上線那天，改一個班別會靜靜改掉所有歷史班表的應工作分鐘。
 */
import {
  bigint,
  boolean,
  char,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'

/**
 * 工時管理方式代碼。
 *
 * **資料字典沒有定代碼值，這是本計畫自行定案的**（計畫 §5.1、§10）：`1 一般`、`2 輪班`、
 * `3 彈性`、`4 責任制`。待命班與備勤班不列入——字典明列它們仍需獨立設計。
 *
 * **不用 DB ENUM**（通用規範 §1.4）：改 ENUM 要 `ALTER TABLE` 重建，在大表上是鎖表操作；
 * 新增一個代碼值是業務常態，不該變成 DDL 變更。代碼值的唯一來源是這個 const object。
 *
 * **UI 定案列的「跨日班／分段班／中空班」刻意不做成這欄的值**：那些不是「工時管理方式」而是
 * **形狀**，已經由 `shift_work_periods` 的 `end_day_offset` 與時段筆數表達了。做成代碼會是
 * 第二份真相——跟 {@link isOvernight} 與 `is_overnight` 兩份真相同一個問題（計畫 §4.1）。
 */
export const ShiftWorkType = {
  /** 一般班：單一固定時段，不跨日。 */
  Regular: 1,
  /** 輪班：依排班規則在多種班別間輪替（規則本身不在本表，見計畫 §2 排班部分）。 */
  Rotating: 2,
  /** 彈性：僅標記彈性旗標，區間與核心工時本輪不做（計畫 §4.3、§10，已定案採甲案）。 */
  Flexible: 3,
  /** 責任制：不受一般工時管理方式約束的班別。 */
  ResponsibilitySystem: 4,
} as const

export type ShiftWorkTypeValue = (typeof ShiftWorkType)[keyof typeof ShiftWorkType]

export const shiftDefinitions = mysqlTable(
  'shift_definitions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `companies.id`（見下方 `fk_shift_definitions_company`）。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /** 班別代碼；可修改，但不得與同公司其他未刪除班別重複（見 `uq_shift_definitions_company_code`）。 */
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    /** 工時管理方式，見 {@link ShiftWorkType}。 */
    workTypeCode: int('work_type_code').$type<ShiftWorkTypeValue>().notNull(),
    /**
     * **推導值，不得由呼叫端送進來**（計畫 §4.1，已定案）：由 service 在寫入時依
     * `shift_work_periods` 算出——任一工作時段的 `end_day_offset > 0` 即為真。
     *
     * request schema 裡根本沒有這個欄位（不是「收進來再驗算」，是「不收」）：收了就要處理
     * 「送進來的值跟算出來的不一樣」這種情況，而任何處置都要有人決定一次；不收就沒有這個問題。
     *
     * **不一致的具體後果**：`is_overnight=false` 但某個時段 `end_day_offset=1`，班別列表顯示
     * 「非跨日」，出勤判定卻按跨日處理——兩邊都不會報錯，症狀是某些人的工時永遠差八小時。
     */
    isOvernight: boolean('is_overnight').notNull(),
    /** 彈性班旗標。僅此一欄，彈性區間與核心工時本輪不做（計畫 §4.3、§10：已定案採甲案）。 */
    isFlexible: boolean('is_flexible').notNull(),
    /**
     * **推導值，不得由呼叫端送進來**（計畫 §4.1，已定案）：由 service 在寫入時算出
     * ＝各工作時段 `work_minutes` 總和 － 無薪休息的 `break_minutes` 總和。
     *
     * **為什麼要存而不是每次現算**：`attendance_results.scheduled_minutes` 會引用它，而字典的
     * 核心原則是「規則改版不得覆蓋歷史」。存下來的是那一版班別當時的應工作分鐘；現算的話，
     * 日後改了計算方式（例如有薪休息的認定），所有歷史出勤判定的分母會跟著變。
     */
    requiredWorkMinutes: int('required_work_minutes').notNull(),
    /** 用途或異動說明。資料字典標為必填，逐欄照抄（計畫要求「依字典逐欄」）。 */
    description: text('description').notNull(),
    isActive: boolean('is_active').notNull(),
    // datetime 一律 mode: 'string'，存的就是台北牆鐘時間，不做任何換算（後端規範 §6）。
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * **與資料字典不同：新增欄位。** 軟刪除與唯一鍵的衝突（後端規範 §4.3，比照 `employees`／`roles`）。
     *
     * MariaDB 的 UNIQUE 索引中 `NULL` 互不相等，因此 `UNIQUE(company_id, code, deleted_at)`
     * 對「未刪除的資料」等於沒擋——所有未刪除班別的 `deleted_at` 都是 NULL，彼此不相等，
     * 於是同一個班別代碼可以重複建立好幾筆，而約束看起來是有設的。改成 `NOT NULL DEFAULT 0` 的
     * `deleted_seq`（軟刪除時同時寫入非零值，例如刪除時間戳），有效資料就全部落在
     * `deleted_seq = 0` 這一組內，唯一性才真的成立。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /** 字典的 `UNIQUE(company_id, code)` 在軟刪除下的正確形式，理由見 `deletedSeq` 欄位註解。 */
    uniqueIndex('uq_shift_definitions_company_code').on(table.companyId, table.code, table.deletedSeq),
    /**
     * **與資料字典不同：新增唯一鍵。** 供日後 `employee_schedules` 建複合外鍵
     * `(company_id, shift_definition_id) → shift_definitions(company_id, id)` 指向。
     *
     * 理由與 `roles`／`employees` 相同：MariaDB 的外鍵必須指向被參照端的唯一索引，只指向 `id`
     * 的話，「這筆班表的 company_id 與班別的 company_id 一致」就沒有任何約束擋著——A 公司的班表
     * 可以指向 B 公司的班別，而資料庫完全接受，查詢有回資料、不會觸發任何錯誤。
     */
    uniqueIndex('uq_shift_definitions_company_id').on(table.companyId, table.id),
    // 比照 roles 的 ix_roles_company_status：班別清單依啟用狀態篩選是計畫 §6 明列的列表條件。
    index('ix_shift_definitions_company_active').on(table.companyId, table.isActive),
    foreignKey({ name: 'fk_shift_definitions_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
