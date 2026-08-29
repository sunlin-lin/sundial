/**
 * `employee_job_title_histories`：員工職稱歷史（資料字典 `02-employee-payroll-cost.md` 第
 * 101–117 行；實作計畫 `plans/05-employee-onboarding.md` §4.3、§8 Stage 5）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 理由與 `employee-department-histories.ts` 檔頭第 1 點
 *    完全同構——`TenantDatabase`（§4.2）要求帶公司範圍的表要有自己的 `company_id`。
 * 2. **`job_title_id` 是單欄外鍵，不是複合外鍵，這是與 `employee_department_histories`
 *    唯一的結構差異，原因必須說清楚：** `departments.company_id` **必填**，因此
 *    `(company_id, department_id) → departments(company_id, id)` 這種複合外鍵可以同時保證
 *    「部門存在」與「部門屬於同一家公司」。但 `job_titles.company_id` **可為 NULL**
 *    （系統預設職稱，見 `db/schema/job-titles.ts` 檔頭）——一個屬於 A 公司的任職被指派一個
 *    `company_id IS NULL` 的系統預設職稱時，複合外鍵 `(company_id=A, job_title_id=X) →
 *    job_titles(company_id, id)` 找不到任何一列可以匹配（`job_titles` 那一列的 `company_id`
 *    是 `NULL`，不是 `A`），寫入會被外鍵擋下——而這是一個完全合法的操作。因此本表只能用單欄外鍵
 *    `job_title_id → job_titles.id`，只保證「這個職稱存在」，不保證「屬於同一家公司」；
 *    「這個職稱是不是這家公司看得到的（自訂或系統預設）」改由應用層驗證
 *    （`modules/employments/job-title-histories/impl/employments-job-title-histories.
 *    find-job-title.repository.ts`）。
 * 3. **沒有 `deleted_at`／`deleted_seq`**：理由與 `employee-department-histories.ts` 相同——
 *    「結束」用 `effective_to` 表示，不是刪除。
 *
 * **§4.3 期間重疊：同一任職同一時間只能一筆有效職稱，鎖的粒度＝任職**（與 `employee_department_
 * histories` 完全相同，資料字典原文：「同一任職同一時間只能有一筆有效職稱」）。定案處置：
 *   - `UNIQUE(company_id, employment_id, effective_from)` 擋掉最常見的「同一天建立兩筆」。
 *   - 寫入前對 `employee_employments` 那一列 `SELECT ... FOR UPDATE`（鎖的粒度＝任職，見
 *     `modules/employments/job-title-histories/impl/employments-job-title-histories.
 *     create.service.ts`）。
 *   - 兩道防線都不完美，處置與殘留風險與 `employee-department-histories.ts` 同構。
 */
import { char, date, datetime, foreignKey, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employeeEmployments } from './employee-employments.ts'
import { jobTitles } from './job-titles.ts'

export const employeeJobTitleHistories = mysqlTable(
  'employee_job_title_histories',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employmentId: char('employment_id', { length: 36 }).notNull(),
    /** 見檔頭第 2 點：單欄外鍵，不是複合外鍵——`job_titles.company_id` 可為 NULL。 */
    jobTitleId: char('job_title_id', { length: 36 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /** §4.3：擋最常見的「同一任職同一天建立兩筆職稱歷史」，不是完整的重疊防線（見檔頭）。 */
    uniqueIndex('uq_employee_job_title_histories_employment_from').on(
      table.companyId,
      table.employmentId,
      table.effectiveFrom,
    ),
    /** §4.5：索引以 company_id 開頭。供「這個任職的職稱歷史」查詢使用。 */
    index('ix_employee_job_title_histories_company_employment').on(table.companyId, table.employmentId),
    index('ix_employee_job_title_histories_company_job_title').on(table.companyId, table.jobTitleId),
    foreignKey({
      name: 'fk_employee_job_title_histories_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    /** 防止跨公司掛接，理由與 `employee-department-histories.ts` 的複合外鍵同構。 */
    foreignKey({
      name: 'fk_employee_job_title_histories_employment',
      columns: [table.companyId, table.employmentId],
      foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
    }),
    /** 單欄外鍵，理由見檔頭第 2 點。 */
    foreignKey({
      name: 'fk_employee_job_title_histories_job_title',
      columns: [table.jobTitleId],
      foreignColumns: [jobTitles.id],
    }),
  ],
)
