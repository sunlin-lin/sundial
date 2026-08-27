/**
 * `companies`：SaaS Tenant 根節點——公司或個人雇主主檔
 * （資料字典 `01-company-access-organization.md` 第 12–46 行）。
 *
 * 本表**沒有 `company_id` 欄位**：它的 `id` 就是公司範圍本身。因此它既不屬於 §4.5
 * 「索引以 `company_id` 開頭」的適用對象，也不會被列入 `CompanyScopedTable`
 * ——把它交給 `TenantDatabase` 會變成「用 company_id 過濾 company_id 表」這種說不通的形狀，
 * 而跨公司的平台管理功能本來就該走 §4.2 指定的獨立路徑，不是套用租戶封裝。
 *
 * 三組地址（登記、實際、發票）直接展開在主檔而不另建通用地址子表：目前只確認這三種，
 * 子表會讓每一次讀公司資料都多一次 join，卻換不到任何目前需要的彈性（資料字典的設計理由）。
 */
import { bigint, char, datetime, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

/**
 * 主體種類。不用 DB ENUM（通用規範 §1.4）：MariaDB 改 ENUM 要 `ALTER TABLE` 重建，
 * 在大表上是鎖表操作，而新增一個代碼值是業務常態，不該變成 DDL 變更。
 * 代碼值的唯一來源是這個 const object，DB 端只存字串。
 */
export const CompanyType = {
  /** 公司型主體：`tax_id`（統編）必填，`company_code`＝統編＋3 碼流水號。 */
  Company: 'COMPANY',
  /** 個人雇主：無統編，`company_code` ＝建立日 `YYYYMMDD`＋3 碼流水號。 */
  Individual: 'INDIVIDUAL',
} as const

export type CompanyTypeValue = (typeof CompanyType)[keyof typeof CompanyType]

/**
 * 法律型態。同樣不用 DB ENUM。
 *
 * **誠實註明：資料字典只寫「法律型態」，沒有列舉值。** 這裡的代碼是依台灣商業登記的常見型態暫定的，
 * 且刻意留了 `Other`——沒有逃生出口時，遇到未列舉的型態只有兩種下場：擅自塞一個近似值（資料就此失真），
 * 或是為了一筆資料改動 union 與所有 switch。等業務端把清單定案後，這裡才是唯一要改的地方。
 */
export const CompanyLegalType = {
  /** 有限公司 */
  LimitedCompany: 'LIMITED_COMPANY',
  /** 股份有限公司 */
  CompanyLimitedByShares: 'COMPANY_LIMITED_BY_SHARES',
  /** 獨資（含個人雇主） */
  SoleProprietorship: 'SOLE_PROPRIETORSHIP',
  /** 合夥 */
  Partnership: 'PARTNERSHIP',
  /** 其他；見上方說明。 */
  Other: 'OTHER',
} as const

export type CompanyLegalTypeValue = (typeof CompanyLegalType)[keyof typeof CompanyLegalType]

/**
 * 公司資料狀態。值與 `RoleStatus`／`CompanyUserStatus` 一致，不另創一組字面值
 * ——同一個概念在不同表用不同代碼（`ENABLED` vs `ACTIVE`）時，每一段跨表的狀態判斷
 * 都要先查「這張表是哪一套」，而查錯不會有任何地方變紅。
 */
export const CompanyStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const

export type CompanyStatusValue = (typeof CompanyStatus)[keyof typeof CompanyStatus]

export const companies = mysqlTable(
  'companies',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * 全域唯一業務編號。公司型為統編＋3 碼流水號、個人型為建立日 `YYYYMMDD`＋3 碼流水號，無分隔符。
     *
     * 存字串不存整數（資料字典明訂）：前導零與「008」這種流水號用整數存會被吃掉，
     * 而編號是要印在文件上、拿去比對的，值變了就對不上。
     */
    companyCode: varchar('company_code', { length: 32 }).notNull(),
    companyType: varchar('company_type', { length: 32 }).$type<CompanyTypeValue>().notNull(),
    legalType: varchar('legal_type', { length: 32 }).$type<CompanyLegalTypeValue>().notNull(),
    /**
     * 統一編號。條件必填（公司型主體使用），因此 DB 層是 nullable
     * ——「`company_type = COMPANY` 時必填」是條件約束，MariaDB 沒有部分 NOT NULL，
     * 由 service 層維持。存字串不存整數，理由同 `company_code`。
     */
    taxId: varchar('tax_id', { length: 16 }),
    /** 正式名稱或個人姓名。 */
    name: varchar('name', { length: 128 }).notNull(),
    shortName: varchar('short_name', { length: 64 }),
    // 三組地址（登記／實際／發票）。郵遞區號存字串：3 碼與 6 碼並存，且 `100` 這種值
    // 用整數存會在顯示時掉成 `100` 以外的形狀（前導零、位數），而它是要印在信封上的。
    registeredPostalCode: varchar('registered_postal_code', { length: 16 }),
    registeredCity: varchar('registered_city', { length: 32 }),
    registeredDistrict: varchar('registered_district', { length: 32 }),
    registeredAddress: varchar('registered_address', { length: 255 }),
    actualPostalCode: varchar('actual_postal_code', { length: 16 }),
    actualCity: varchar('actual_city', { length: 32 }),
    actualDistrict: varchar('actual_district', { length: 32 }),
    actualAddress: varchar('actual_address', { length: 255 }),
    invoicePostalCode: varchar('invoice_postal_code', { length: 16 }),
    invoiceCity: varchar('invoice_city', { length: 32 }),
    invoiceDistrict: varchar('invoice_district', { length: 32 }),
    invoiceAddress: varchar('invoice_address', { length: 255 }),
    status: varchar('status', { length: 32 }).$type<CompanyStatusValue>().notNull(),
    // datetime 一律 mode: 'string'，存的就是台北牆鐘時間，不做任何換算（§6）。
    // 用 mode: 'date' 會讓值在 JS Date 與 DB 之間來回換算一次，只要有一處時區設定不同，
    // 時刻就會靜靜偏移，而且不會有任何錯誤訊息。
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
    deletedAt: datetime('deleted_at', { mode: 'string' }),
    /**
     * **與資料字典不同：新增欄位。** 資料字典的約束是 `UNIQUE(company_code)`，
     * 本表改為 `UNIQUE(company_code, deleted_seq)`，理由是 §4.3 那條已定案的規則。
     *
     * 為什麼一定要改：本表同時有 `deleted_at` 軟刪除與「`company_code` 全域唯一」。
     * 直覺的作法 `UNIQUE(company_code, deleted_at)` 在 MariaDB 完全無效——UNIQUE 索引中
     * `NULL` 互不相等，而所有未刪除的公司 `deleted_at` 都是 NULL，於是它們彼此不衝突，
     * 同一組 `company_code` 可以重複建立好幾家公司，而約束看起來是有設的。
     * 改成 `NOT NULL DEFAULT 0` 的 `deleted_seq`（軟刪除時一併寫入非零值，例如刪除時間戳），
     * 有效資料就全部落在 `deleted_seq = 0` 這一組內，唯一性才真的成立。
     *
     * 為什麼不維持字典原文的 `UNIQUE(company_code)`：那會讓刪除過的編號永遠不能再用，
     * 而資料字典同時要求「流水號只增不減、不重用」——兩者其實不衝突，但把唯一鍵設成單欄之後，
     * 軟刪除的列會永久佔住那個編號，日後任何「重新啟用一家誤刪的公司」都得先想辦法繞過唯一鍵。
     * 另一條路（唯一性交給應用層檢查）在併發下必然失守：兩個請求會同時查到「沒有」然後都寫進去（§4.3）。
     */
    deletedSeq: bigint('deleted_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    /** 見 `deletedSeq` 的說明：這是資料字典 `UNIQUE(company_code)` 在軟刪除下的正確形式。 */
    uniqueIndex('uq_companies_company_code').on(table.companyCode, table.deletedSeq),
    /**
     * 統編查詢。**刻意不是唯一索引**：資料字典寫明 `company_code` ＝統編＋3 碼流水號，
     * 也就是同一個統編底下允許存在多家公司（分支機構、不同事業部各自成為一個 Tenant），
     * 設成唯一會讓第二家永遠建不起來。而配號時必須先問「這個統編目前用到第幾號」，
     * 沒有這個索引的話，每建一家公司都要全表掃描一次。
     */
    index('ix_companies_tax_id').on(table.taxId, table.deletedSeq),
    /**
     * 平台端的公司清單（依狀態篩選）。帶上 `deleted_seq` 是因為 §4.3 要求查詢一律排除已刪除，
     * 那個條件若不在索引裡，篩選出來的列還要逐列回表判斷 `deleted_at`。
     */
    index('ix_companies_status').on(table.status, table.deletedSeq),
  ],
)
