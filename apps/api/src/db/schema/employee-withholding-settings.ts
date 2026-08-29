/**
 * `employee_withholding_settings`：每月薪資扣繳方式及有效期間（資料字典 `02-employee-payroll-cost.md`
 * 第 184–200 行；實作計畫 `plans/05-employee-onboarding.md` §8 Stage 3）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 理由與 `employee-employments.ts` 檔頭第 1 點完全同構。
 * 2. **沒有 `deleted_at`／`deleted_seq`。** 字典本來就沒有列這兩欄——「修改時結束舊設定並新增一筆」
 *    （字典原文）用 `effective_to` 表示結束，不是刪除。
 *
 * **§4.3 期間重疊：** 「同一員工的有效期間不得重疊」資料庫沒有 exclusion constraint 擋得住。
 * 定案處置：
 *   - `UNIQUE(company_id, employee_id, effective_from)` 擋掉最常見的「同一天建立兩筆」。
 *   - 寫入前對 `employees` 那一列 `SELECT ... FOR UPDATE`（鎖的粒度＝員工，見
 *     `modules/withholding/main/impl/withholding-main.create.service.ts`）。
 *   - 兩道防線都不完美，處置與殘留風險寫在該檔，理由與 `employee-employments.ts` 同構。
 */
import { char, date, datetime, foreignKey, index, int, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employees } from './employees.ts'

/** 扣繳方式代碼，見字典列舉：1 薪資所得扣繳稅額表、2 固定 5%。存整數，值域由應用層驗證。 */
export const WithholdingMethodCode = {
  Table: 1,
  FlatFivePercent: 2,
} as const

export type WithholdingMethodCodeValue = (typeof WithholdingMethodCode)[keyof typeof WithholdingMethodCode]

export const employeeWithholdingSettings = mysqlTable(
  'employee_withholding_settings',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    withholdingMethodCode: int('withholding_method_code').$type<WithholdingMethodCodeValue>().notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /** §4.3：擋最常見的「同一員工同一天建立兩筆扣繳設定」，不是完整的重疊防線（見檔頭）。 */
    uniqueIndex('uq_employee_withholding_settings_employee_from').on(
      table.companyId,
      table.employeeId,
      table.effectiveFrom,
    ),
    /** §4.5：索引以 company_id 開頭。供「這位員工目前有效扣繳設定」查詢使用。 */
    index('ix_employee_withholding_settings_company_employee').on(table.companyId, table.employeeId),
    foreignKey({
      name: 'fk_employee_withholding_settings_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接，理由與 `employee-employments.ts` 的複合外鍵同構。 */
    foreignKey({
      name: 'fk_employee_withholding_settings_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
  ],
)
