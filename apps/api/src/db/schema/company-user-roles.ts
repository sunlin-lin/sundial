/**
 * `company_user_roles`：公司成員與角色的指派及撤銷歷史
 * （資料字典 `01-company-access-organization.md`）。
 *
 * 以撤銷時間結束指派而非刪除，才保留得住指派者、撤銷者與有效歷程——這類資料是稽核事實，
 * 實體 DELETE 之後爭議發生時完全無法舉證（§4.3、§5.3）。
 */
import { bigint, char, datetime, foreignKey, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companyUsers } from './company-users.ts'
import { roles } from './roles.ts'

export const companyUserRoles = mysqlTable(
  'company_user_roles',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * **與資料字典不同：新增欄位。** 自 `company_users` 冗餘帶入的公司範圍。
     *
     * 理由同 `role_permissions.company_id`：§4.2 要求每一次查詢都帶 `company_id` 條件，
     * 而「使用者在本公司有哪些角色」是每個請求都會走的授權查詢——它必須能單獨帶公司條件，
     * 不能依賴呼叫端記得 join 回 `company_users`。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    companyUserId: char('company_user_id', { length: 36 }).notNull(),
    roleId: char('role_id', { length: 36 }).notNull(),
    assignedAt: datetime('assigned_at', { mode: 'string' }).notNull(),
    /**
     * 與資料字典不同：**明確建立複合 FK → `company_users(company_id, id)`**
     *（字典只寫「指派者公司成員 ID」）。
     *
     * 稽核欄位沒有外鍵時，指向不存在成員的值可以寫進去，而稽核紀錄的價值全部建立在
     * 「這個 ID 真的對得到一個人」之上——對不到的那幾筆，事後沒有任何方法補救。
     */
    assignedBy: char('assigned_by', { length: 36 }).notNull(),
    /** NULL 表示這筆指派仍然有效。 */
    revokedAt: datetime('revoked_at', { mode: 'string' }),
    /** 與資料字典不同：明確建立複合 FK → `company_users(company_id, id)`（見下方 extra config），理由同 `assigned_by`。 */
    revokedBy: char('revoked_by', { length: 36 }),
    /**
     * **與資料字典不同：新增欄位。** 與 `roles.deleted_seq` 同一個機制（§4.3），
     * 只是這裡結束一筆指派叫「撤銷」而不是「刪除」，因此欄名為 `revoked_seq`。
     *
     * 資料字典要求「同一公司成員與角色同時只能有一筆有效指派」，但那個約束若寫成
     * `UNIQUE(company_user_id, role_id, revoked_at)`，在 MariaDB 的 UNIQUE 索引中
     * `NULL` 互不相等——所有「有效」的紀錄 `revoked_at` 都是 NULL，彼此不衝突，
     * 於是同一個人可以被重複指派同一個角色好幾次，而約束看起來是有設的。
     * 改成 `NOT NULL DEFAULT 0` 的 `revoked_seq`（撤銷時寫入非零值）之後，唯一性才真的成立。
     */
    revokedSeq: bigint('revoked_seq', { mode: 'number' }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    /**
     * **與資料字典不同：新增欄位。** 字典只有 `created_at`。
     *
     * 撤銷是對既有列的 UPDATE（寫入 `revoked_at`／`revoked_by`／`revoked_seq`），
     * 沒有 `updated_at` 的話，「這筆指派最後一次被動到是什麼時候」在資料上不存在，
     * 而通用規範 §1.4 要求主檔表必備 `created_at`／`updated_at`。
     */
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_company_user_roles_assignment').on(
      table.companyId,
      table.companyUserId,
      table.roleId,
      table.revokedSeq,
    ),
    // 授權查詢的主要路徑：某位成員在本公司目前有哪些角色。§4.5 要求以 company_id 開頭。
    index('ix_company_user_roles_company_user').on(table.companyId, table.companyUserId, table.revokedSeq),
    // 反查：本公司哪些成員仍在使用某個角色（角色刪除前必須先移轉，見資料字典的 UI 規則）。
    index('ix_company_user_roles_company_role').on(table.companyId, table.roleId, table.revokedSeq),
    /**
     * 稽核欄位的支撐索引。兩個作用同時成立：
     * 1. 「這個人指派／撤銷過哪些角色」的稽核反查，§4.5 要求以 `company_id` 開頭。
     * 2. 讓下面的複合外鍵有索引可用。**沒有它們，InnoDB 會自動補一個只有
     *    `(assigned_by)`／`(revoked_by)` 的索引**——那種索引不以 `company_id` 開頭，
     *    等於在這張表上開一個 §4.5 擋不到的洞，而且它是自動長出來的，review 看不見。
     */
    index('ix_company_user_roles_company_assigned_by').on(table.companyId, table.assignedBy),
    index('ix_company_user_roles_company_revoked_by').on(table.companyId, table.revokedBy),
    /**
     * **四條外鍵一律複合，全部帶上 `company_id`。**
     *
     * 原本它們是單純 FK（只指向 `company_users.id`／`roles.id`），於是這張表的 `company_id`
     * 與被參照者的 `company_id` **可以不同**：一筆「A 公司的指派紀錄」指向 B 公司的成員或 B 公司的角色，
     * 資料庫完全接受。後果是它會出現在 A 公司的成員角色查詢裡——查詢有回資料、沒有任何錯誤，
     * 而權限判定就以那一列為準。這是 §4.2 講的那種「通常是客戶先發現」的隔離破口，
     * 只是它發生在寫入端而不是查詢端，連封裝都擋不到。
     *
     * 改成指向 `company_users(company_id, id)` 與 `roles(company_id, id)` 之後，
     * 跨公司的指派紀錄在資料庫層就寫不出來。這也順帶讓本表的 `company_id` 間接受到約束
     * ——它必須對得到一筆 `company_users`，而後者的 `company_id` 有 FK 指向 `companies.id`，
     * 因此本表不需要（也不該）再單獨拉一條 FK 到 `companies`：那會變成同一個事實由兩條外鍵各查一次。
     */
    foreignKey({
      name: 'fk_company_user_roles_company_user',
      columns: [table.companyId, table.companyUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
    foreignKey({
      name: 'fk_company_user_roles_role',
      columns: [table.companyId, table.roleId],
      foreignColumns: [roles.companyId, roles.id],
    }),
    foreignKey({
      name: 'fk_company_user_roles_assigned_by',
      columns: [table.companyId, table.assignedBy],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
    foreignKey({
      name: 'fk_company_user_roles_revoked_by',
      columns: [table.companyId, table.revokedBy],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
  ],
)
