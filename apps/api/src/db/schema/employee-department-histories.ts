/**
 * `employee_department_histories`：任職期間的部門歸屬歷史（資料字典 `02-employee-payroll-cost.md`
 * 第 72–88 行；實作計畫 `plans/05-employee-onboarding.md` §4.3、§8 Stage 3）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 理由與 `employee-employments.ts` 檔頭第 1 點完全同構
 *    ——`TenantDatabase`（§4.2）要求帶公司範圍的表要有自己的 `company_id`，否則每支查詢都要手寫
 *    JOIN 才能拿到公司條件。這裡由 `(company_id, employment_id) → employee_employments(company_id,
 *    id)` 與 `(company_id, department_id) → departments(company_id, id)` 兩條複合外鍵保證這一欄
 *    與 `employment_id`／`department_id` 所屬公司一致，不是第二份真相。
 * 2. **沒有 `deleted_at`／`deleted_seq`。** 字典本來就沒有列這兩欄——歷史列一經寫入不軟刪除，
 *    「結束」用 `effective_to` 表示，不是刪除（與 `company_user_roles` 用 `revoked_at` 結束一筆
 *    指派、不刪除是同一種設計）。
 *
 * **§4.3 期間重疊：** 「同一任職同一時間只能有一筆有效部門」資料庫沒有 exclusion constraint 擋得住。
 * 定案處置：
 *   - `UNIQUE(company_id, employment_id, effective_from)` 擋掉最常見的「同一天建立兩筆」。
 *   - 寫入前對 `employee_employments` 那一列 `SELECT ... FOR UPDATE`（**鎖的粒度＝任職，不是員工**
 *     ——見 `modules/employments/department-histories/impl/employments-department-histories.
 *     create.service.ts`）。
 *   - 兩道防線都不完美，處置與殘留風險寫在該檔，理由與 `employee-employments.ts` 同構。
 */
import { char, date, datetime, foreignKey, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { departments } from './departments.ts'
import { employeeEmployments } from './employee-employments.ts'

export const employeeDepartmentHistories = mysqlTable(
  'employee_department_histories',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employmentId: char('employment_id', { length: 36 }).notNull(),
    departmentId: char('department_id', { length: 36 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /** §4.3：擋最常見的「同一任職同一天建立兩筆部門歷史」，不是完整的重疊防線（見檔頭）。 */
    uniqueIndex('uq_employee_department_histories_employment_from').on(
      table.companyId,
      table.employmentId,
      table.effectiveFrom,
    ),
    /** §4.5：索引以 company_id 開頭。供「這個任職的部門歷史」查詢與成環／成員數計算使用。 */
    index('ix_employee_department_histories_company_employment').on(table.companyId, table.employmentId),
    index('ix_employee_department_histories_company_department').on(table.companyId, table.departmentId),
    foreignKey({
      name: 'fk_employee_department_histories_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接，理由與 `employee-employments.ts` 的複合外鍵同構。 */
    foreignKey({
      name: 'fk_employee_department_histories_employment',
      columns: [table.companyId, table.employmentId],
      foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
    }),
    foreignKey({
      name: 'fk_employee_department_histories_department',
      columns: [table.companyId, table.departmentId],
      foreignColumns: [departments.companyId, departments.id],
    }),
  ],
)
