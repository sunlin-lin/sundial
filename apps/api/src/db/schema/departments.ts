/**
 * `departments`：公司部門樹（資料字典 `01-company-access-organization.md`「departments」節，
 * 及該節之下「定案：樹的四條規則 ＋ 六項待定的處置」；實作計畫 `plans/05-employee-onboarding.md` §5）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **複合外鍵 `(company_id, parent_id) → departments(company_id, id)`，不是字典寫的單欄
 *    `parent_id → departments.id`。** 單欄外鍵下，A 公司的部門可以掛在 B 公司底下而**資料庫完全
 *    接受**——查詢有回資料、沒有任何錯誤。需要配套的 `UNIQUE(company_id, id)`（理由與 `roles`／
 *    `shift_definitions` 對其他表的複合外鍵相同）。
 * 2. **新增 `deleted_seq`**：`UNIQUE(company_id, code, deleted_seq)` 取代字典的
 *    `UNIQUE(company_id, code)`（軟刪除配套，比照 `employees`／`roles`／`shift_definitions`，§4.3）。
 *
 * **四條樹規則裡，只有「不得跨公司」是這裡的複合外鍵擋的。** 其餘三條——不得成環、有子部門不得
 * 刪除、搬移子樹不改寫員工部門歷史——資料庫層完全擋不住，實作在 `modules/departments/main/`
 * （`domain/department-tree.ts` 的 `wouldCreateCycle`、service 層的「有子部門」檢查、update
 * service 對「不碰任何員工部門歷史表」的顯式不作為，見各檔說明）。
 *
 * **不含部門主管欄位，這是刻意的，不是遺漏**（資料字典「定案」表已詳述）：這套系統的權限模型是
 * 扁平的（角色 ＋ 權限碼，不看部門）。一旦有主管欄位，下一步一定有人拿它做權限判斷，長出一套
 * 不受任何權限碼檢查約束的第二套授權邏輯。日後若要限制簽核範圍，正確作法是在權限碼上加範圍，
 * 不是加部門主管欄位。同理不含排序欄位（樹狀按名稱排）與主管任期，皆為字典「定案」表的處置。
 */
import { bigint, char, datetime, foreignKey, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'

/** 部門狀態。不用 DB ENUM（通用規範 §1.4），代碼值以本 const object 為唯一來源。 */
export const DepartmentStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type DepartmentStatusValue = (typeof DepartmentStatus)[keyof typeof DepartmentStatus]

export const departments = mysqlTable(
  'departments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** FK → `companies.id`（見下方 `fk_departments_company`）。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    /**
     * 根部門為 NULL（字典定案）。自關聯的複合外鍵宣告在下方的 extra config，
     * 避免欄位定義引用自身造成循環的型別推導（比照 `permissions.parentId` 的既有作法）。
     */
    parentId: char('parent_id', { length: 36 }),
    /** 公司內部門代碼；可修改，但不得與同公司其他未刪除部門重複（見下方唯一鍵）。 */
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    /**
     * 部門狀態，見 {@link DepartmentStatus}。**停用只影響「能不能被選為新部門」，不動歷史**
     * （字典「定案」表）：`employee_department_histories` 記的是「那一天他在哪個部門」，
     * 停用一個部門不改變「他去年在那裡」這件事，本表也不需要任何欄位去表達這條規則
     * ——規則落在查詢「可選部門」的那一段業務邏輯裡，不是資料庫約束。
     */
    status: varchar('status', { length: 32 }).$type<DepartmentStatusValue>().notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * **與資料字典不同：新增欄位。** 軟刪除與唯一鍵的衝突（§4.3，比照 `employees`／`roles`／
     * `shift_definitions`）：MariaDB 的 UNIQUE 索引中 `NULL` 互不相等，`UNIQUE(company_id, code,
     * deleted_at)` 對「未刪除的資料」等於沒擋。`deleted_seq` 讓有效資料全部落在 `= 0` 這一組內。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /** 字典的 `UNIQUE(company_id, code)` 在軟刪除下的正確形式，理由見 `deletedSeq` 欄位註解。 */
    uniqueIndex('uq_departments_company_code').on(table.companyId, table.code, table.deletedSeq),
    /**
     * **與資料字典不同：新增唯一鍵。** 供下方 `fk_departments_parent` 複合外鍵指向。
     *
     * MariaDB 的外鍵必須指向被參照端的唯一索引，只指向 `id` 的話，「這筆部門的 parent 與自己
     * 同一家公司」就沒有任何約束擋著——A 公司的部門可以掛在 B 公司底下，資料庫完全接受，
     * 查詢有回資料、不會觸發任何錯誤。
     */
    uniqueIndex('uq_departments_company_id').on(table.companyId, table.id),
    /**
     * 供「這個部門底下有沒有子部門」查詢（刪除前檢查，`modules/departments/main/impl/
     * departments-main.has-children.repository.ts`）與整棵樹查詢使用；同時是下方複合外鍵的
     * 支撐索引（前綴 `(company_id, parent_id)` 正是外鍵欄位組，明確建出來，InnoDB 就不會再
     * 自動補一個看不見的——自動長出來的索引除了不以 `company_id` 開頭之外還有一個問題：
     * 它是隱形的，review 看不見）。
     */
    index('ix_departments_company_parent').on(table.companyId, table.parentId),
    foreignKey({ name: 'fk_departments_company', columns: [table.companyId], foreignColumns: [companies.id] }),
    /**
     * 複合外鍵：見檔頭第 1 點。**`onDelete('cascade')` 是本檔案唯一不是 `NO ACTION` 的外鍵，
     * 理由必須寫清楚**——應用層**永遠不會**對這張表下真正的 `DELETE`：刪除一律走
     * `deleted_at`／`deleted_seq` 的軟刪除（§4.3），而且「有子部門不得刪除」的規則本身就保證
     * 軟刪除發生的當下這一列沒有任何子列。CASCADE 只會在**清空整間公司**的維運腳本
     * （`db/schema/index.ts` 的 `companyScopedTablesInDeleteOrder` 清理）真的執行實體 `DELETE`
     * 時才被觸發：對一張自我參照的表，單一陳述式刪光同一家公司所有列時，InnoDB 是逐列檢查外鍵，
     * 父列若在同一陳述式中排在子列之前被處理就會撞 `errno 1451`，而刪除順序不受應用層控制。
     * `NO ACTION` 在這裡不是「更安全」，是「這支腳本會直接失敗」；CASCADE 換來的是清理腳本
     * 一定跑得完，而業務流程完全不會走到這條路徑（業務層從不下 `DELETE`）。
     */
    foreignKey({
      name: 'fk_departments_parent',
      columns: [table.companyId, table.parentId],
      foreignColumns: [table.companyId, table.id],
    }).onDelete('cascade'),
  ],
)
