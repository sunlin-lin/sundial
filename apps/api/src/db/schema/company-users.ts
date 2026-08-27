/**
 * `company_users`：登入帳號加入公司的成員關係（資料字典 `01-company-access-organization.md`）。
 *
 * Tenant 成員關係與全域帳號分離，才支援同一帳號加入多家公司及非員工協作者。
 * 辦理離職時停用本表的紀錄，不刪除 `users`、角色或歷史紀錄。
 */
import { char, datetime, foreignKey, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { users } from './users.ts'

/**
 * 公司內帳號狀態。**不使用 DB ENUM**（通用規範 §1.4）：MariaDB 改 ENUM 需 `ALTER TABLE` 重建，
 * 在大表上是鎖表操作，而新增一個代碼值是業務常態，不該變成 DDL 變更。
 * 代碼值的唯一來源是這個 const object，DB 端只存字串。
 */
export const CompanyUserStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type CompanyUserStatusValue = (typeof CompanyUserStatus)[keyof typeof CompanyUserStatus]

export const companyUsers = mysqlTable(
  'company_users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * FK → `companies.id`（見下方 extra config 的 `fk_company_users_company`）。
     *
     * 這條外鍵原本缺席，因為建立本表時 `companies` 還不存在、指向不存在的表建不起來；
     * 由 `0005_add_company_foreign_keys.sql` 補上。缺它的期間，成員可以掛在一個不存在的
     * 公司 ID 底下——而查詢一律以 `company_id` 過濾，這種孤兒列不會出現在任何清單裡，
     * 也就永遠不會有人發現它存在。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    /**
     * 與資料字典不同之處：**沒有建立 FK → `employees.id`**，理由同 `company_id`（表尚未建立）。
     * 員工帳號必填、外部協作者可空的規則目前只能由 service 層維持。
     */
    employeeId: char('employee_id', { length: 36 }),
    status: varchar('status', { length: 32 }).$type<CompanyUserStatusValue>().notNull(),
    activatedAt: datetime('activated_at', { mode: 'string' }),
    deactivatedAt: datetime('deactivated_at', { mode: 'string' }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    // 同公司一名使用者只能有一個成員關係。
    uniqueIndex('uq_company_users_company_user').on(table.companyId, table.userId),
    /**
     * **與資料字典不同：新增唯一鍵。** 與 `roles.uq_roles_company_id` 同一個用途——
     * 供 `company_user_roles` 的複合外鍵 `(company_id, company_user_id) → company_users(company_id, id)` 指向。
     *
     * MariaDB 的外鍵只能指向被參照端的唯一索引，而本表原本只有 `id` 是唯一的。
     * 只指向 `id` 的話，一筆 `company_id` 填成別家公司的角色指派**可以順利寫進去**，
     * 而它會出現在那家公司的成員角色查詢裡；有了這個唯一鍵，那種列在資料庫層就寫不出來。
     */
    uniqueIndex('uq_company_users_company_id').on(table.companyId, table.id),
    // §4.5：帶 company_id 的表，索引必須以 company_id 開頭，否則列表查詢退化成全表掃描，
    // 資料量成長後會同時拖垮所有租戶。
    index('ix_company_users_company_status').on(table.companyId, table.status),
    // 外鍵一律具名並與 migration 的名稱逐字相同：讓 drizzle 自動命名的話，
    // schema 與手寫 SQL 會產生兩組不同的約束名，而錯誤訊息（唯一鍵衝突、外鍵違反）
    // 報的是資料庫端的名字——對不上程式碼裡的任何字串，追查時只能逐表比對。
    foreignKey({ name: 'fk_company_users_user', columns: [table.userId], foreignColumns: [users.id] }),
    foreignKey({ name: 'fk_company_users_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
