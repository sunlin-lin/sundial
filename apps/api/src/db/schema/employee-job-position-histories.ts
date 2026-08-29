/**
 * `employee_job_position_histories`：員工職務歷史（資料字典 `02-employee-payroll-cost.md` 第
 * 138–154 行；實作計畫 `plans/05-employee-onboarding.md` §4.3 末段、§8 Stage 5）。
 *
 * **★ 本表是計畫 §4.3 三張期間重疊表裡唯一的例外，鎖與唯一鍵的粒度都不是「任職」，必須先講清楚
 * 為什麼：** 字典明文「同一任職可同時有多個有效職務，**但同一職務期間不得重疊**」——鎖粒度是
 * `(employment_id, job_position_id)` 這個**組合**，不是任職本身：
 *
 * - **鎖到任職是錯的**：會把「同一任職同時擔任兩個不同職務」這個合法情境擋掉——兩個不同職務的
 *   建立請求會被迫排隊，如果順便照抄 `employee_department_histories` 的作法（重疊檢查只看
 *   `employment_id`），兩個不同職務只要期間重疊就會被誤判成衝突而拒絕其中一筆，而那正是字典
 *   明文允許的情境。
 * - **鎖到職務是錯的**：如果重疊檢查只看 `job_position_id`（不看 `employment_id`），兩個不同員工
 *   的任職被指派同一個職務、期間剛好重疊，會被誤判成衝突——但那是兩個人各自的任職，彼此毫不相干。
 * - **正確的判斷必須同時看兩者**：`modules/employments/job-position-histories/impl/employments-
 *   job-position-histories.create.service.ts` 的重疊查詢一律 `WHERE employment_id = ? AND
 *   job_position_id = ?` 同時成立，兩條規則因此同時滿足。
 *
 * **序列化用的 `SELECT ... FOR UPDATE` 鎖在 `job_positions` 那一列，不是本表、也不是
 * `employee_employments`**：見上述 impl 檔案的檔頭「為什麼鎖 `job_positions`」，這裡只講資料庫層
 * 需要什麼配套——`job_positions` 的 PK（`id`）本身就是可以拿來鎖定的既有列，寫入本表前一定要先
 * 確認 `job_position_id` 存在，鎖定與存在性檢查因此可以是同一次查詢。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位**：理由與 `employee_department_histories` 檔頭第 1 點同構。
 * 2. **`job_position_id` 是單欄外鍵，不是複合外鍵**：`job_positions.company_id` 可為 NULL
 *    （系統預設職務），理由與 `employee-job-title-histories.ts` 檔頭第 2 點逐字同構。
 * 3. **唯一鍵是 `UNIQUE(company_id, employment_id, job_position_id, effective_from)`**，
 *    比 `employee_department_histories`／`employee_job_title_histories` 多一欄
 *    `job_position_id`——少了它，同一任職對兩個不同職務在同一天各建立一筆歷史會被誤判成
 *    唯一鍵衝突，而那是合法操作（同一任職可同時有多個職務）。
 * 4. **沒有 `deleted_at`／`deleted_seq`**：理由同其餘歷史表，「結束」用 `effective_to` 表示。
 */
import { char, date, datetime, foreignKey, index, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employeeEmployments } from './employee-employments.ts'
import { jobPositions } from './job-positions.ts'

export const employeeJobPositionHistories = mysqlTable(
  'employee_job_position_histories',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employmentId: char('employment_id', { length: 36 }).notNull(),
    /** 見檔頭第 2 點：單欄外鍵，不是複合外鍵——`job_positions.company_id` 可為 NULL。 */
    jobPositionId: char('job_position_id', { length: 36 }).notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 見檔頭第 3 點：★ 比其餘歷史表多帶 `job_position_id`。這是擋「同一任職同一職務同一天建立
     * 兩筆」的第二道防線（第一道是寫入前對 `job_positions` 的 `FOR UPDATE` 鎖，見檔頭）；
     * 不是完整的重疊防線——只擋完全同日，不擋跨日重疊。
     */
    uniqueIndex('uq_employee_job_position_histories_employment_position_from').on(
      table.companyId,
      table.employmentId,
      table.jobPositionId,
      table.effectiveFrom,
    ),
    /** §4.5：索引以 company_id 開頭。供「這個任職目前有哪些職務」查詢使用。 */
    index('ix_employee_job_position_histories_company_employment').on(table.companyId, table.employmentId),
    index('ix_employee_job_position_histories_company_job_position').on(table.companyId, table.jobPositionId),
    foreignKey({
      name: 'fk_employee_job_position_histories_company',
      columns: [table.companyId],
      foreignColumns: [companies.id],
    }),
    foreignKey({
      name: 'fk_employee_job_position_histories_employment',
      columns: [table.companyId, table.employmentId],
      foreignColumns: [employeeEmployments.companyId, employeeEmployments.id],
    }),
    /** 單欄外鍵，理由見檔頭第 2 點。 */
    foreignKey({
      name: 'fk_employee_job_position_histories_job_position',
      columns: [table.jobPositionId],
      foreignColumns: [jobPositions.id],
    }),
  ],
)
