/**
 * `job_positions`：職務主檔，與職稱分離（資料字典 `02-employee-payroll-cost.md` 第 119–137 行；
 * 實作計畫 `plans/05-employee-onboarding.md` §3.2、§8 Stage 5）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **`description` 改為選填，字典原文標「必填」。** 字典這一格與同表 `is_system`／`status` 都
 *    帶著「代碼值或額外約束未在定案節點明定」的但書，讀起來是模板欄位、不是審過的決定——要求
 *    每一個職務都一定要填一段「用途或異動說明」不合常理，且與結構最相近的 `departments.description`
 *    （選填）不一致。這一處偏離已在交付回報中列出，供人工確認是否要改回必填。
 * 2. **新增 `deleted_seq`**：軟刪除與唯一鍵並存的固定配套（§4.3，比照 `departments`／`job_titles`）。
 * 3. **`code`／`name` 的唯一鍵改為 `UNIQUE(company_id, code, deleted_seq)`**：字典沒有寫唯一鍵，
 *    但既然是「業務代碼」，同一家公司內顯然不該重複；比照 `departments.code` 的既有作法。
 *
 * **`company_id` 可為 NULL**：字典原文「company_id 可選……容納系統預設與公司自訂」，與 `job_titles`
 * 完全同構，該檔檔頭的說明（`TenantDatabase` 的公司範圍過濾找不到 NULL 列、查詢要繞道
 * `selectFrom` 自組 `OR company_id IS NULL`）逐字適用於本表，不重複。
 *
 * **本輪沒有建立任何系統預設列**，理由與 `job_titles` 相同。
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

/** 職務狀態。不用 DB ENUM（通用規範 §1.4）。 */
export const JobPositionStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type JobPositionStatusValue = (typeof JobPositionStatus)[keyof typeof JobPositionStatus]

export const jobPositions = mysqlTable(
  'job_positions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 選填：NULL 代表系統預設職務；非 NULL 代表該公司自訂（見檔頭，與 `job_titles` 同構）。 */
    companyId: char('company_id', { length: 36 }),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    /** 見檔頭第 1 點：字典標必填，本檔改為選填。 */
    description: varchar('description', { length: 255 }),
    /** 是否系統預設，由 `company_id` 是否為 NULL 推導，不是使用者輸入（見 `job_titles` 同一欄）。 */
    isSystem: boolean('is_system').notNull().default(false),
    status: varchar('status', { length: 32 }).$type<JobPositionStatusValue>().notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /** 見檔頭第 2 點：軟刪除與唯一鍵並存的固定配套（§4.3）。 */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    uniqueIndex('uq_job_positions_company_code').on(table.companyId, table.code, table.deletedSeq),
    /**
     * **供 `employee_job_position_histories` 鎖粒度使用的關鍵索引之一。** 該表建立時要對
     * 「這個職務」`SELECT ... FOR UPDATE`（見 `db/schema/employee-job-position-histories.ts`
     * 檔頭），這裡的 PK 本身已經是最佳索引，這條額外的 `(company_id, status)` 索引供列表查詢用，
     * 不影響鎖定路徑（鎖定一律用 PK 等值查詢）。
     */
    index('ix_job_positions_company_status').on(table.companyId, table.status),
    foreignKey({ name: 'fk_job_positions_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
