/**
 * `job_titles`：系統預設及公司自訂職稱（資料字典 `02-employee-payroll-cost.md` 第 90–99 行；
 * 實作計畫 `plans/05-employee-onboarding.md` §3.2、§8 Stage 5）。
 *
 * **與資料字典不同之處，且這裡的落差比其他表都大，必須先說清楚：**
 *
 * 字典裡這張表的欄位只列了 `id` 與 `company_id` 兩欄，其餘（代碼、名稱、狀態、時間戳、軟刪除）
 * 完全沒有定義——對照同一份文件裡的 `job_positions`（第 119–137 行）欄位齊全，兩張表在
 * 「系統預設及公司自訂」這個定位上逐字相同，落差顯然是字典本身漏寫，不是刻意的窄表設計。
 * 本檔的處置是**比照 `job_positions` 補齊欄位**：`code`／`name`／`description`／`is_system`／
 * `status`／`created_at`／`updated_at`／`deleted_at`／`deleted_seq`。任務交付要求「職稱主檔的
 * 列表／建立／修改／刪除（軟刪除）」，沒有這些欄位那組端點根本開不出來。**這一處字典缺漏已在
 * 交付回報中列出，需要人工確認補回字典本身。**
 *
 * **`description` 沒有跟隨 `job_positions` 字典原文的「必填」標記**：`job_positions` 字典把
 * `description` 標成必填「用途或異動說明」，但那一格與同表 `is_system`／`status` 等欄位一樣帶著
 * 「代碼值或額外約束未在定案節點明定」的但書，讀起來更像模板欄位沒有真正被審過，不是深思熟慮
 * 的決定——一個「職稱」主檔要求建立者一定要填「用途說明」不合常理（`departments.description`
 * 就是選填）。本檔兩張表的 `description` 一律選填，理由在 `job-positions.ts` 重複一次。
 *
 * **`company_id` 可為 NULL**：字典原文「company_id 可選是為了同時容納系統預設與公司自訂職稱」。
 * 這與 `departments`／`employees` 那批表的 `company_id` 必填不同，代價是它**雖然出現在
 * `db/schema/index.ts` 的 `CompanyScopedTable` 聯集裡，但 `TenantDatabase` 的公司範圍過濾
 * （`eq(companyId, 本公司)`）天生找不到 `company_id IS NULL` 的系統預設列**——這正是我們要的：
 * 公司只能新增／修改／刪除自己的職稱，不能動到系統預設；查詢「這家公司看得到哪些職稱」
 * （公司自訂 ＋ 系統預設）則必須繞過 `TenantDatabase` 的預設 scope，改用 `selectFrom` 自組
 * `company_id = 本公司 OR company_id IS NULL` 的條件（見 `modules/job-titles/main/impl/
 * job-titles-main.list.repository.ts`）。
 *
 * **本輪沒有建立任何系統預設列（`company_id IS NULL`）**：Stage 5 只交付主檔與端點，
 * 系統預設清單要放哪些職稱是產品決定，不在本次任務範圍內，留給日後的 seed。
 */
import {
  bigint,
  boolean,
  char,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'

/** 職稱狀態。不用 DB ENUM（通用規範 §1.4），比照 `departments` 的 `DepartmentStatus`。 */
export const JobTitleStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type JobTitleStatusValue = (typeof JobTitleStatus)[keyof typeof JobTitleStatus]

export const jobTitles = mysqlTable(
  'job_titles',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * 選填：NULL 代表系統預設職稱、全平台共用；非 NULL 代表該公司自訂（見檔頭）。
     * FK 宣告在下方——MariaDB 允許外鍵欄位為 NULL，NULL 值不受外鍵約束檢查。
     */
    companyId: char('company_id', { length: 36 }),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    /**
     * 是否系統預設。**由 `company_id` 是否為 NULL 推導，不是使用者輸入**——本輪的建立端點只服務
     * 「新增公司自訂職稱」，一律寫入 `false`；`true` 只會出現在日後的系統預設 seed。
     */
    isSystem: boolean('is_system').notNull().default(false),
    status: varchar('status', { length: 32 }).$type<JobTitleStatusValue>().notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * 軟刪除與唯一鍵並存的固定配套（§4.3，比照 `departments`／`employees`）。**`company_id` 可為
     * NULL 這件事不影響這個配套**：唯一鍵 `uq_job_titles_company_code` 仍然把 `deletedSeq` 放進去，
     * 只是 NULL 分組在 MariaDB 的唯一索引中互不相等，多筆系統預設列（`company_id IS NULL`）就算
     * `code` 相同也不會撞鍵——本輪不建立任何系統預設列，這個邊界情況留給日後補 seed 時處理。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    uniqueIndex('uq_job_titles_company_code').on(table.companyId, table.code, table.deletedSeq),
    /** §4.5：索引以 company_id 開頭。供「這家公司自訂的職稱」列表查詢使用。 */
    index('ix_job_titles_company_status').on(table.companyId, table.status),
    foreignKey({ name: 'fk_job_titles_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
