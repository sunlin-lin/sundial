/**
 * `users`：全域登入帳號與驗證資料（資料字典 `01-company-access-organization.md`）。
 *
 * 不併入員工資料：登入身分與員工任職生命週期不同——同一帳號可加入多家公司，
 * 員工離職也不得抹除帳號及其歷史操作。離職是停用 `company_users`，不是刪 `users`。
 *
 * 本表**沒有 `company_id`**（全域表），因此不套用 §4.5 的「索引以 company_id 開頭」。
 */
import { boolean, char, datetime, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

export const users = mysqlTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 登入帳號，全域唯一。 */
    username: varchar('username', { length: 64 }).notNull(),
    /** 單向雜湊（Argon2id 或 bcrypt cost ≥ 12）。禁止保存、log 或回傳明碼與 hash（§5.1）。 */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    /** 新增員工時由建立者設定初始密碼，此欄為 `true`，首次登入強制修改。 */
    mustChangePassword: boolean('must_change_password').notNull(),
    passwordChangedAt: datetime('password_changed_at', { mode: 'string' }),
    // 全部 datetime 一律 mode: 'string'：存的就是台北牆鐘時間，不做任何換算（§6）。
    // 用 mode: 'date' 會讓值在 JS Date 與 DB 之間來回換算一次，只要有一處的時區設定不同，
    // 時刻就會靜靜偏移，而且不會有任何錯誤訊息。
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('uq_users_username').on(table.username)],
)
