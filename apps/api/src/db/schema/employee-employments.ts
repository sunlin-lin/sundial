/**
 * `employee_employments`：員工每次任職關係（資料字典 `02-employee-payroll-cost.md` 第 47–68 行；
 * 實作計畫 `plans/05-employee-onboarding.md` §3.1、§7、§8 Stage 3）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 字典只給 `employee_id`，公司範圍要透過
 *    `employee_id → employees.company_id` 才能得到。但 `TenantDatabase`（`db/client.ts`，§4.2）
 *    要求「帶公司範圍的表」必須自己有一欄 `company_id`，否則每一支查詢都得手寫 JOIN 才能拿到公司
 *    條件——那正是 §4.2 想堵住的破口（漏一次 JOIN 就是跨公司讀寫，且查詢照樣有回資料）。
 *    `employees.ts` 的 `uq_employees_company_id` 唯一鍵本來就是**為了這件事預先鋪好的**
 *    （該檔註解：「供日後其他表（`employee_employments`…）建立複合外鍵…指向」），這裡只是把它用上。
 *    複合外鍵 `(company_id, employee_id) → employees(company_id, id)` 保證這一欄不會被填成
 *    與 `employee_id` 所屬公司不同的值，因此它不是「多一份可能漂移的真相」，是資料庫保證過的推導值。
 * 2. **新增 `deleted_seq`**：軟刪除與唯一鍵並存的固定配套（§4.3，理由與 `employees`／`departments`
 *    相同）。
 *
 * **§4.3 期間重疊：** 「同一員工同一時間最多一筆有效任職」資料庫沒有 exclusion constraint 擋得住。
 * 定案處置（計畫 §4.3）：
 *   - `UNIQUE(company_id, employee_id, hire_date, deleted_seq)` 擋掉最常見的「同一天建立兩筆任職」。
 *   - 寫入前對 `employees` 那一列 `SELECT ... FOR UPDATE`（鎖的粒度＝員工，見
 *     `modules/employments/main/impl/employments-main.create.service.ts`）。
 *   - **這兩道防線都不完美**：唯一鍵只擋同日，鎖只在「寫入者都乖乖遵守鎖協定」時有效——這是
 *     刻意的取捨，把失敗模式從「靜默重疊」換成「拿不到鎖而失敗」，殘留風險寫在該檔。
 *
 * 離職三欄（`leave_date`／`last_working_date`／`leave_reason_code`）三缺一即錯，且
 * `last_working_date ≤ leave_date`——這兩條資料庫層都沒有 CHECK constraint（MariaDB 10.2 之後雖有
 * CHECK 語法，但跨欄條件式必填在這裡用應用層驗證更清楚地表達「三缺一」這種非簡單值域的規則，
 * 且與其他模組的既有作法一致：業務規則一律在 service 層，schema 只管型態與可不可為 NULL）。
 */
import {
  bigint,
  char,
  date,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { employees } from './employees.ts'

/**
 * 本次任職狀態。**不用 DB ENUM**（通用規範 §1.4）。
 *
 * 字典只寫「本次任職狀態」，沒有列舉值——這兩個值是本次自行決定的，僅表達「在職／離職」這一個
 * 二元事實（回任會是新的一筆 `ACTIVE`，不會把 `LEFT` 的舊列改回來，計畫 §7）。
 */
export const EmploymentStatus = {
  Active: 'ACTIVE',
  Left: 'LEFT',
} as const

export type EmploymentStatusValue = (typeof EmploymentStatus)[keyof typeof EmploymentStatus]

/**
 * 僱用型態代碼，見字典列舉：1 正職、2 兼職、3 約聘、4 派遣、5 工讀、6 臨時、7 顧問、8 實習。
 * 存整數（字典型態），值域由應用層（routes 的聯集字面值）驗證，不用 DB ENUM。
 */
export const EmploymentTypeCode = {
  FullTime: 1,
  PartTime: 2,
  Contract: 3,
  Dispatch: 4,
  WorkStudy: 5,
  Temporary: 6,
  Consultant: 7,
  Intern: 8,
} as const

export type EmploymentTypeCodeValue = (typeof EmploymentTypeCode)[keyof typeof EmploymentTypeCode]

export const employeeEmployments = mysqlTable(
  'employee_employments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    employmentTypeCode: int('employment_type_code').$type<EmploymentTypeCodeValue>().notNull(),
    /** 任職性質代碼。字典未列舉值，先開放任意正整數，值域待業務定案。 */
    employmentNatureCode: int('employment_nature_code'),
    hireDate: date('hire_date', { mode: 'string' }).notNull(),
    /** 在職為 NULL；辦理離職時必填，且三欄同時必填（service 層驗證，見檔頭）。 */
    leaveDate: date('leave_date', { mode: 'string' }),
    lastWorkingDate: date('last_working_date', { mode: 'string' }),
    /** 離職原因代碼。字典未列舉值，先開放任意正整數。 */
    leaveReasonCode: int('leave_reason_code'),
    status: varchar('status', { length: 32 }).$type<EmploymentStatusValue>().notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /** 見檔頭第 2 點：軟刪除與唯一鍵並存的固定配套（§4.3）。 */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /** §4.3：擋最常見的「同一員工同一天建立兩筆任職」，不是完整的重疊防線（見檔頭）。 */
    uniqueIndex('uq_employee_employments_employee_hire_date').on(
      table.companyId,
      table.employeeId,
      table.hireDate,
      table.deletedSeq,
    ),
    /** 供 `employee_department_histories` 的複合外鍵 `(company_id, employment_id) → …(company_id, id)` 指向。 */
    uniqueIndex('uq_employee_employments_company_id').on(table.companyId, table.id),
    /** §4.5：帶 company_id 的表，索引必須以 company_id 開頭。供列表查詢與「這位員工目前任職」查詢使用。 */
    index('ix_employee_employments_company_employee').on(table.companyId, table.employeeId, table.deletedSeq),
    foreignKey({ name: 'fk_employee_employments_company', columns: [table.companyId], foreignColumns: [companies.id] }),
    /**
     * 複合外鍵：防止跨公司掛接（理由與 `departments.fk_departments_parent` 檔頭第 1 點同構）。
     * `NO ACTION`：應用層一律軟刪除，不對本表下真正的 `DELETE`（清空整間公司的維運腳本走
     * `companyScopedTablesInDeleteOrder`，本表排在 `employees` 之前即可，不需要 CASCADE）。
     */
    foreignKey({
      name: 'fk_employee_employments_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
  ],
)
