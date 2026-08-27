/**
 * `role_permissions`：角色與權限的多對多關聯（資料字典 `01-company-access-organization.md`）。
 */
import { char, datetime, foreignKey, index, mysqlTable, primaryKey } from 'drizzle-orm/mysql-core'
import { permissions } from './permissions.ts'
import { roles } from './roles.ts'

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    /**
     * **與資料字典不同：新增欄位。** 自 `roles` 冗餘帶入的公司範圍。
     *
     * 兩個理由：
     * 1. §4.2 要求**每一次查詢都必須帶 `company_id` 條件**。沒有這一欄時，查某角色的權限
     *    只能寫 `WHERE role_id = ?`，公司條件得靠 join `roles` 才帶得進來——而「這次查詢有沒有
     *    join 到 roles」是掃描腳本看不出來的，那條檢查就等於在這張表上失效。
     * 2. 它讓下面的複合外鍵成立，把「授權與角色必須同公司」交給資料庫擋，而不是靠應用層記得。
     *
     * 冗餘的代價是要與 `roles.company_id` 保持一致，而複合外鍵正是保證這件事的機制
     * ——填錯公司的那一列根本寫不進去。
     *
     * **本欄不另外拉一條 FK → `companies.id`。** 下面的複合外鍵已要求它對得到一筆 `roles`，
     * 而 `roles.company_id` 自 `0005_add_company_foreign_keys.sql` 起有 FK 指向 `companies.id`
     * ——公司存在這件事已經被保證了。再加一條只會讓每次寫入多查一張表，換不到任何額外的約束。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    roleId: char('role_id', { length: 36 }).notNull(),
    permissionId: char('permission_id', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 與資料字典不同：唯一鍵由 `UNIQUE(role_id, permission_id)` 改為
     * `(company_id, role_id, permission_id)`，且以**主鍵**形式表達。
     *
     * 加 `company_id` 是上面那一欄的直接後果。用主鍵而不是另建唯一索引，是因為 InnoDB 在沒有
     * 主鍵時會自建一個看不見的 rowid 當叢集索引——等於多存一份沒人用得到的東西，
     * 而這張表的每一列都會被它撐大。資料字典「不另設沒有業務意義的 id」的意圖完全保留。
     */
    primaryKey({ name: 'pk_role_permissions', columns: [table.companyId, table.roleId, table.permissionId] }),
    /**
     * 複合外鍵：`(company_id, role_id) → roles(company_id, id)`。
     *
     * 只指向 `roles.id` 的話，一列 `company_id` 填成別家公司的授權**可以順利寫進去**，
     * 而它會在「這家公司有哪些角色權限」的查詢裡憑空出現。指向複合唯一鍵之後，
     * 這種列在資料庫層就寫不出來。
     */
    foreignKey({
      name: 'fk_role_permissions_role',
      columns: [table.companyId, table.roleId],
      foreignColumns: [roles.companyId, roles.id],
    }),
    foreignKey({
      name: 'fk_role_permissions_permission',
      columns: [table.permissionId],
      foreignColumns: [permissions.id],
    }),
    // §4.5：索引以 company_id 開頭。用於「這個權限被本公司哪些角色使用」的反查。
    index('ix_role_permissions_company_permission').on(table.companyId, table.permissionId),
  ],
)
