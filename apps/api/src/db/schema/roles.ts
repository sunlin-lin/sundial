/**
 * `roles`：公司角色主檔（資料字典 `01-company-access-organization.md`）。
 *
 * 不把 HR、主管這類名稱寫死，讓各公司建立自己的權責模型；`is_system` 用來區分系統預設與自訂角色。
 */
import { bigint, boolean, char, datetime, foreignKey, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'

/** 角色狀態。不用 DB ENUM，代碼值以本 const object 為唯一來源。 */
export const RoleStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type RoleStatusValue = (typeof RoleStatus)[keyof typeof RoleStatus]

export const roles = mysqlTable(
  'roles',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * FK → `companies.id`（見下方 extra config 的 `fk_roles_company`）。
     * 這條外鍵原本缺席，因為建立本表時 `companies` 還不存在；由 `0005_add_company_foreign_keys.sql` 補上。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    isSystem: boolean('is_system').notNull(),
    status: varchar('status', { length: 32 }).$type<RoleStatusValue>().notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * **與資料字典不同：新增欄位。** 軟刪除與唯一鍵的衝突（§4.3）。
     *
     * MariaDB 的 UNIQUE 索引中 `NULL` 互不相等，因此 `UNIQUE(company_id, code, deleted_at)`
     * 對「未刪除的資料」等於沒擋（每一筆的 `deleted_at` 都是 NULL，彼此不相等）。
     * 改用 `NOT NULL DEFAULT 0` 的 `deleted_seq`，軟刪除時同時寫入非零值（如刪除時間戳），
     * 於是有效資料全部落在 `deleted_seq = 0` 這一組內，唯一性真的成立。
     *
     * 不這麼做的代價二選一：沿用 `UNIQUE(company_id, code)` 則刪掉的代碼永遠不能再用；
     * 把唯一性丟給應用層檢查則併發下兩筆同代碼會同時通過。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_roles_company_code').on(table.companyId, table.code, table.deletedSeq),
    /**
     * **與資料字典不同：新增唯一鍵。** 供 `role_permissions` 的複合外鍵
     * `(company_id, role_id) → roles(company_id, id)` 指向。
     *
     * MariaDB 的外鍵必須指向被參照端的唯一索引，而 `roles` 原本只有 `id` 是唯一的
     * ——只指向 `id` 的話，「這筆授權的 company_id 與角色的 company_id 一致」就沒有任何約束擋著，
     * 只能靠應用層記得比對，而漏掉一次就是跨公司授權，且查詢有回資料、不會觸發任何錯誤。
     */
    uniqueIndex('uq_roles_company_id').on(table.companyId, table.id),
    index('ix_roles_company_status').on(table.companyId, table.status),
    foreignKey({ name: 'fk_roles_company', columns: [table.companyId], foreignColumns: [companies.id] }),
  ],
)
