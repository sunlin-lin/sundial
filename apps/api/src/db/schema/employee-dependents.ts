/**
 * `employee_dependents`：薪資扣繳／報稅所需扶養親屬及資格條件（資料字典
 * `02-employee-payroll-cost.md` 第 156–182 行；實作計畫 `plans/05-employee-onboarding.md`
 * §3.3、§8 Stage 7）。
 *
 * **與資料字典不同之處：**
 *
 * 1. **新增 `company_id` 欄位，字典沒有。** 理由與 `employees.ts` 檔頭第 1 點同構
 *    （`TenantDatabase` 要求「帶公司範圍的表」必須自己有一欄 `company_id`）。
 * 2. **新增 `deleted_seq`。** 軟刪除與唯一鍵並存的固定配套（§4.3，理由與 `employees.ts` 同構）
 *    ——見下方 `uq_employee_dependents_company_employee_identity` 的說明。
 *
 * **本表沒有 §4.3 的「有效期間不得重疊」處置。** 這是刻意的，不是漏做：資料字典對
 * `employee_withholding_settings`／`employee_labor_pension_settings` 都明文寫著「同一員工的
 * 有效期間不得重疊」，但對本表**沒有**這句話——而且不可能有：同一員工在同一時間本來就可以有
 * 多名眷屬同時列入扶養（配偶＋多名子女），眷屬與眷屬之間沒有「同一時間只能一筆」這種排他關係，
 * 因此 `overlapsAnyPeriod`（`shared/effective-period.ts`）那一套「同一擁有者、同一時段只能一筆」
 * 的鎖完全不適用於本表。
 *
 * 需要防的是另一件事：**同一位員工的同一個眷屬（同一個身分證字號）被重複新增**。這靠下面的
 * `uq_employee_dependents_company_employee_identity` 唯一鍵擋——直接寫入並攔截唯一鍵違反
 * （§4.3：唯一性一律交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」），不需要 `FOR UPDATE`：
 * 沒有「先查一批既有紀錄、再判斷會不會與新的一筆衝突」這個步驟，衝突與否單靠一個唯一鍵就能
 * 由資料庫原子判定，因此本表**沒有併發測試**（不像 `employee_withholding_settings`／
 * `employee_labor_pension_settings` 需要鎖與併發測試，理由完整寫在後兩者的 schema 檔頭）。
 *
 * **「終止」是對既有列的條件式 UPDATE，不是新增一筆。** UI 定案（`docs/ui/20-employee-list.md`
 * §3.4）「可以新增、修改及終止扶養眷屬」的「終止」，與 `employee_employments` 的離職是同一種
 * 動作形狀：把 `end_date`／`status` 寫回同一列，理由是眷屬關係與任職不同——「這個人不再列入
 * 扶養」不是「換了一個新的扶養關係」，沒有「回任」這種語意需要保留舊列不動。
 */
import { Buffer } from 'node:buffer'
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import { BLIND_INDEX_BYTE_LENGTH, ENCRYPTED_OVERHEAD_MAX_BYTES } from '../field-encryption.ts'
import { companies } from './companies.ts'
import { employees } from './employees.ts'

/**
 * 二進位欄位的自訂型別。**與 `employees.ts` 的 `encryptedBytes` 逐字同構，理由不重複**：
 * 不能用 drizzle 內建的 `binary()`／`varbinary()`，它們的 `mapFromDriverValue` 會把驅動回傳的
 * Buffer 當 UTF-8 解碼，而加密後的位元組不是合法的 UTF-8。
 */
const encryptedBytes = customType<{
  data: Buffer
  driverData: Buffer
  config: { length: number }
  configRequired: true
}>({
  dataType: (config) => `varbinary(${config.length})`,
})

/** 固定長度的二進位欄位（blind index 用）。理由同 {@link encryptedBytes}。 */
const fixedBytes = customType<{
  data: Buffer
  driverData: Buffer
  config: { length: number }
  configRequired: true
}>({
  dataType: (config) => `binary(${config.length})`,
})

/** 加密欄位的寬度計算，理由與 `employees.ts` 的同名函式同構。 */
const encryptedWidth = (maxPlaintextBytes: number): number => maxPlaintextBytes + ENCRYPTED_OVERHEAD_MAX_BYTES

/**
 * 眷屬狀態。**不用 DB ENUM**（通用規範 §1.4）。
 *
 * **誠實註明：資料字典只寫「狀態代碼，不使用 DB ENUM」，沒有列舉值，這兩個值是本次自行決定的。**
 * UI 定案 §3.4「可以新增、修改及終止扶養眷屬」只需要分得出「仍列入扶養」與「已終止」兩種狀態，
 * 因此只開這兩個值；命名比照 `EmploymentStatus`（`ACTIVE`／`LEFT`）與 `EmploymentStatus` 的
 * 二元事實表達方式，但眷屬的「終止」用 `TERMINATED` 而不是沿用 `LEFT`——後者的語意是「人離開了」，
 * 眷屬終止的是扶養關係，不是這個人本身，兩者不該共用同一個字。
 */
export const DependentStatus = {
  Active: 'ACTIVE',
  Terminated: 'TERMINATED',
} as const

export type DependentStatusValue = (typeof DependentStatus)[keyof typeof DependentStatus]

/**
 * 關係代碼，見字典列舉：1 配偶、2 父、3 母、4 子女、5 兄弟姊妹、6 祖父母、7 孫子女、8 其他。
 * 存整數，值域由應用層驗證，不用 DB ENUM。
 */
export const DependentRelationshipCode = {
  Spouse: 1,
  Father: 2,
  Mother: 3,
  Child: 4,
  Sibling: 5,
  Grandparent: 6,
  Grandchild: 7,
  Other: 8,
} as const

export type DependentRelationshipCodeValue = (typeof DependentRelationshipCode)[keyof typeof DependentRelationshipCode]

export const employeeDependents = mysqlTable(
  'employee_dependents',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** 見檔頭第 1 點：字典沒有的欄位，為了 `TenantDatabase` 的公司範圍封裝而加。 */
    companyId: char('company_id', { length: 36 }).notNull(),
    employeeId: char('employee_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    /**
     * 身分證加密值。明文上限 10 碼（與 `employees.identity_number_encrypted` 同一種格式），
     * 取 32 位元組留餘裕。§5.1：禁止新增明文欄位或明文索引。
     */
    identityNumberEncrypted: encryptedBytes('identity_number_encrypted', { length: encryptedWidth(32) }).notNull(),
    /**
     * 身分證查詢 Hash（blind index，HMAC-SHA256，固定 32 位元組）。用途與 `employees` 同構：
     * 加密值每次寫入的 IV 都不同，密文不能拿來比對，重複檢查一律靠這一欄的唯一鍵。
     */
    identityNumberHash: fixedBytes('identity_number_hash', { length: BLIND_INDEX_BYTE_LENGTH }).notNull(),
    /** 出生年月日加密值。明文是 `YYYY-MM-DD`（10 位元組）。 */
    birthdayEncrypted: encryptedBytes('birthday_encrypted', { length: encryptedWidth(16) }).notNull(),
    relationshipCode: int('relationship_code').$type<DependentRelationshipCodeValue>().notNull(),
    isStudent: boolean('is_student').notNull(),
    isDisabled: boolean('is_disabled').notNull(),
    isUnableToWork: boolean('is_unable_to_work').notNull(),
    isCohabiting: boolean('is_cohabiting').notNull(),
    /** 開始列入扶養日期。 */
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    /** 結束日期；終止時寫入（見檔頭「終止」的說明）。 */
    endDate: date('end_date', { mode: 'string' }),
    status: varchar('status', { length: 32 }).$type<DependentStatusValue>().notNull(),
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /** 見檔頭第 2 點：軟刪除與唯一鍵並存的固定配套（§4.3）。 */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /**
     * 同一位員工的同一個眷屬（同一個身分證字號）不得重複新增。見檔頭：這是本表唯一需要的
     * 重複防線，取代 `employee_withholding_settings` 那一套「有效期間不得重疊」的處置
     * ——多名眷屬本來就可以同時有效，不需要鎖。
     *
     * 帶 `deleted_seq` 的理由與 `employees.uq_employees_company_identity` 相同：
     * 軟刪除後同一個人可以重新建立。
     */
    uniqueIndex('uq_employee_dependents_company_employee_identity').on(
      table.companyId,
      table.employeeId,
      table.identityNumberHash,
      table.deletedSeq,
    ),
    /** §4.5：索引以 company_id 開頭。供「這位員工目前的眷屬清單」查詢使用。 */
    index('ix_employee_dependents_company_employee').on(table.companyId, table.employeeId, table.deletedSeq),
    foreignKey({ name: 'fk_employee_dependents_company', columns: [table.companyId], foreignColumns: [companies.id] }),
    /** 防止跨公司掛接，理由與 `employees.ts` 的複合外鍵同構。 */
    foreignKey({
      name: 'fk_employee_dependents_employee',
      columns: [table.companyId, table.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
  ],
)
