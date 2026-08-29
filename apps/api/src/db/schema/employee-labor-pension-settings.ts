/**
 * `employee_labor_pension_settings`：員工勞退自願提繳率及有效期間（資料字典
 * `02-employee-payroll-cost.md` 第 202–219 行；實作計畫 `plans/05-employee-onboarding.md`
 * §3.3、§8 Stage 7）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 理由與 `employee-withholding-settings.ts` 檔頭第 1 點
 *    完全同構——`TenantDatabase` 要求「帶公司範圍的表」必須自己有一欄 `company_id`。
 * 2. **`created_by` 明確建立複合 FK → `company_users(company_id, id)`**（字典只寫「設定者公司
 *    成員 ID」）。理由與 `company_user_roles.assigned_by` 同構（該檔檔頭）：沒有外鍵時，
 *    指向不存在成員的值可以寫進去，而這一欄的價值全部建立在「這個 ID 真的對得到一個人」之上。
 * 3. **沒有 `deleted_at`／`deleted_seq`。** 字典本來就沒有列這兩欄——「修改」在這張表上是
 *    「結束舊設定並新增一筆」（`effective_to`），不是刪除，與 `employee_withholding_settings`
 *    同一種語意。
 *
 * **§4.3 期間重疊：** 「同一員工的有效期間不得重疊」資料庫沒有 exclusion constraint 擋得住。
 * 定案處置，逐字比照 `employee_withholding_settings`（計畫 §4.3、§8 Stage 7）：
 *   - `UNIQUE(company_id, employee_id, effective_from)` 擋掉最常見的「同一天建立兩筆」。
 *   - 寫入前對 `employees` 那一列 `SELECT ... FOR UPDATE`（鎖的粒度＝員工，見
 *     `modules/labor-pension/main/impl/labor-pension-main.create.service.ts`）。
 *   - 兩道防線都不完美，處置與殘留風險寫在該檔，理由與 `employee-withholding-settings.ts` 同構。
 */
import { char, date, datetime, decimal, foreignKey, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { companyUsers } from './company-users.ts'
import { employees } from './employees.ts'

export const employeeLaborPensionSettings = mysqlTable(
  'employee_labor_pension_settings',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    /** 自願提繳率，例如 6% 保存為 0.0600。字典型態 `decimal(5,4)`，讀寫一律字串（§4.7）。 */
    voluntaryContributionRate: decimal('voluntary_contribution_rate', {
      precision: 5,
      scale: 4,
      mode: 'string',
    }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    /** 設定者公司成員 ID。見檔頭第 2 點：複合 FK，不是裸 `char`。 */
    createdBy: char('created_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /** §4.3：擋最常見的「同一員工同一天建立兩筆勞退設定」，不是完整的重疊防線（見檔頭）。 */
    uniqueIndex('uq_employee_labor_pension_settings_employee_from').on(
      table.companyId,
      table.employeeId,
      table.effectiveFrom,
    ),
    /** §4.5：索引以 company_id 開頭。供「這位員工目前有效勞退設定」查詢使用。 */
    index('ix_employee_labor_pension_settings_company_employee').on(table.companyId, table.employeeId),
    /**
     * `created_by` 的支撐索引，理由與 `company_user_roles` 的同類索引同構（見該檔檔頭）：
     * 沒有它，InnoDB 會自動補一個不以 `company_id` 開頭的索引，而那是 §4.5 擋不到、
     * review 也看不見的洞。
     */
    index('ix_employee_labor_pension_settings_company_created_by').on(table.companyId, table.createdBy),
    foreignKey({
      name: 'fk_employee_labor_pension_settings_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接，理由與 `employee-withholding-settings.ts` 的複合外鍵同構。 */
    foreignKey({
      name: 'fk_employee_labor_pension_settings_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
    /** 見檔頭第 2 點：設定者必須真的是本公司的一位成員。 */
    foreignKey({
      name: 'fk_employee_labor_pension_settings_created_by',
      columns: [table.companyId, table.createdBy],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
  ],
)
