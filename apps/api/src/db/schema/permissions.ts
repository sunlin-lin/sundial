/**
 * `permissions`：系統權限主檔，以 `parent_id` 自關聯建立任意層級的權限樹
 * （資料字典 `01-company-access-organization.md`）。
 *
 * **本表沒有 `company_id`，是全域表。** 權限碼是路徑的機械轉換結果（§5.2.2），
 * 由程式碼決定而不是由客戶決定——每家公司一份副本會讓同一支端點在不同公司有不同的碼，
 * 而推導規則就此失效。因此本表**不套用 §4.5 的「索引以 company_id 開頭」**；
 * 公司自訂的部分落在 `roles` 與 `role_permissions`，那兩張表才帶公司範圍。
 *
 * 權限碼的種類（seed migration 依此建立）：
 * - `<大目錄>`：大目錄分類節點，`is_assignable = false`
 * - `<大目錄>.<次目錄>`：次目錄分類節點，`is_assignable = false`
 * - `<大目錄>.<次目錄>.<動作>`：端點葉節點，`is_assignable = true`
 */
import { bigint, boolean, char, datetime, foreignKey, index, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

/** 權限狀態。不用 DB ENUM。 */
export const PermissionStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type PermissionStatusValue = (typeof PermissionStatus)[keyof typeof PermissionStatus]

export const permissions = mysqlTable(
  'permissions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 根權限為 NULL。自關聯的外鍵宣告在下方的 extra config，避免欄位定義引用自身造成循環的型別推導。 */
    parentId: char('parent_id', { length: 36 }),
    /** 權限碼，等於端點路徑的機械轉換結果（`<大目錄>.<次目錄>.<動作>`）。 */
    code: varchar('code', { length: 128 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    status: varchar('status', { length: 32 }).$type<PermissionStatusValue>().notNull(),
    /**
     * **與資料字典不同：新增欄位**（資料字典本身已記「後續建議補 `is_assignable` 與 `sort_order`」，此處落實）。
     *
     * 分類節點（大目錄、次目錄）存在的目的是讓權限樹在畫面上有層次，它們**不對應任何端點**，
     * 因此授予它們沒有意義。少了這個旗標，UI 無法區分「可以勾選的權限」與「只是標題的節點」，
     * 於是使用者會勾到一個什麼都授不出去的節點，然後回報「權限給了卻沒有用」。
     */
    isAssignable: boolean('is_assignable').notNull(),
    /**
     * **與資料字典不同：新增欄位。** 權限樹的顯示順序。
     *
     * 不存排序時，樹的順序取決於查詢回來的順序（實務上是主鍵或插入順序），
     * 於是新增一個權限就可能讓整棵樹的排列改變，使用者每次打開設定頁看到的順序都不一樣。
     */
    sortOrder: int('sort_order').notNull().default(0),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /** **與資料字典不同：新增欄位。** 理由同 `roles.deleted_seq`（§4.3 的軟刪除唯一鍵）。 */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_permissions_code').on(table.code, table.deletedSeq),
    foreignKey({ name: 'fk_permissions_parent', columns: [table.parentId], foreignColumns: [table.id] }),
    // 權限樹一律「取某個父節點底下的子節點並依 sort_order 排列」，這個索引直接支撐該查詢。
    index('ix_permissions_parent_sort').on(table.parentId, table.sortOrder),
  ],
)
