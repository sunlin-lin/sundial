/**
 * `audit_logs`：誰在什麼時候改了哪一筆資料，以及改了什麼
 * （資料字典 `05-regulatory-system.md`「稽核日誌」；實作計畫 `plans/02-audit-logs.md`）。
 *
 * **這張表只承載「資料異動」一種語意**（計畫 §2）。登入行為、IP、User-Agent、系統執行 log、
 * 使用者瀏覽紀錄一律不放進來，各自另做。理由不是潔癖，是兩種資料的保存策略互斥：
 * 稽核要求「一筆不少、永久保存、不可修改」，行為紀錄要求「量大、可過期清理、可取樣」。
 * 混在同一張表就只能取其一，而通常取到的是後者——於是稽核紀錄跟著被清掉。
 *
 * **與資料字典的出入只有一處**：字典把 `subject_id` 標為 `uuid`，本表訂為 `varchar(64)`，
 * 理由寫在 {@link auditLogs} 的 `subjectId` 欄位註解（計畫 §3.2）。其餘欄位逐欄相符。
 *
 * 明確**不含** `updated_at`、`deleted_at`、`occurred_at`，三者都是刻意不加，
 * 理由見下方各自的說明區塊——寫出來是為了讓「別的表都有、這張沒有」不被讀成漏掉。
 */
import { char, date, datetime, foreignKey, index, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core'
import { companies } from './companies.ts'
import { companyUsers } from './company-users.ts'

/**
 * 操作者類型代碼。
 *
 * **不用 DB ENUM**（通用規範 §1.4，比照 `Gender`／`RefreshTokenRevokeReason`）：MariaDB 改 ENUM 要
 * `ALTER TABLE` 重建，在大表上是鎖表操作，而這張表正是全系統最會長大的表之一（計畫 §10）。
 * 代碼值的唯一來源是這個 const object，DB 端只存整數。
 *
 * **值是整數而不是字串**（本專案其他代碼欄位多為字串）：資料字典把 `actor_type_code` 明訂為
 * `integer`，而稽核表的欄位定義是法遵文件的一部分，型態不自行改動。
 *
 * 兩個值必須分得出來，因為它們在事後追查時的意義完全不同：`CompanyUser` 是「有一個人要負責」，
 * `System` 是「沒有人操作，是排程或驗證器自己發現的」——例如 refresh token 重用偵測（計畫 §7 Stage 2）。
 * 把後者也記成某個人做的，會讓稽核指向一個根本不在場的操作者。
 */
export const AuditActorType = {
  /** 公司成員操作。此時 `actor_company_user_id` 必填。 */
  CompanyUser: 1,
  /** 系統（排程／驗證器）產生。此時 `actor_company_user_id` 為 NULL。 */
  System: 2,
} as const

export type AuditActorTypeValue = (typeof AuditActorType)[keyof typeof AuditActorType]

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /**
     * 所屬公司。FK → `companies.id`（見下方 `fk_audit_logs_company`）。
     *
     * 全域規則：Tenant 資料必須可追溯至 Company（§4.2）。稽核查詢一律帶公司範圍，
     * 三支索引也全部以它開頭（見下方索引註解）。
     */
    companyId: char('company_id', { length: 36 }).notNull(),
    /** 操作者類型，見 {@link AuditActorType}。 */
    actorTypeCode: int('actor_type_code').$type<AuditActorTypeValue>().notNull(),
    /**
     * 操作者公司成員。**條件必填**：`actor_type_code=1` 時必填，`=2`（系統）時為 NULL。
     *
     * 「條件必填」在資料庫層只能寫成 nullable——`NOT NULL` 會讓系統事件無值可填，
     * 而塞一個假的成員 ID 進去比 NULL 糟得多：它會讓稽核指向一個沒做過這件事的人。
     * 兩種情形的區分由 `actor_type_code` 承擔，應用層依它決定本欄是否必填。
     *
     * 外鍵是**複合**的 `(company_id, actor_company_user_id) → company_users(company_id, id)`，
     * 不是單欄 `→ company_users.id`，理由見下方 `fk_audit_logs_actor` 的註解。
     */
    actorCompanyUserId: char('actor_company_user_id', { length: 36 }),
    /**
     * 動作碼，由模組路徑推導（計畫 §4.1），例如 `employees.main.update`、`company-users.roles.assign`。
     *
     * **不另編一套整數代碼**：那會讓每加一支端點就要做一次沒有標準答案的命名判斷，
     * 同一件事在不同人手上會變成 `employee_update`／`update_employee`／`EMPLOYEE_MODIFY`。
     * 由路徑推導則連判斷都不需要，而且與權限碼用的是同一個字串
     * ——「誰被授權做這件事」與「誰真的做了這件事」可以直接對起來。
     *
     * 長度 150 與資料字典一致；沒有端點的事件（排程、憑證驗證器偵測）沿用同一形狀。
     */
    action: varchar('action', { length: 150 }).notNull(),
    /**
     * 資料主體所在的表，例如 `employees`。
     *
     * 合法值就是欄位政策 `AUDIT_FIELD_POLICY` 的 key（計畫 §4.5），型別上由該處收斂，
     * **不在這裡另外維護一份「哪些表會被稽核」的清單**：多維護一份的下場是兩邊會少一邊，
     * 而少的那邊不會報錯。因此本欄在 schema 層維持單純的 `varchar`，不掛 `$type`。
     */
    subjectTable: varchar('subject_table', { length: 64 }).notNull(),
    /**
     * 資料主體主鍵的**字串形式**：uuid 直接存，`bigint` 存十進位字串（計畫 §3.2）。
     *
     * **與資料字典不同：字典寫 `uuid`，這裡是 `varchar(64)`。** 全站的主鍵型態不是只有一種——
     * 法規三表與 `company_regulatory_settings` 用的是 `bigint` auto-increment，而後者
     * **正是稽核表要服務的第一個對象**（計畫 §1：稽核表非先做不可的理由就是它馬上要用）。
     *
     * 訂成 `char(36)` 的話，文件會自相矛盾：一邊說「因為公司投保設定馬上要用所以先做這張表」，
     * 另一邊的型態設計讓它存不進去。而發現的時機會是那個模組動工的當下，屆時本表已經上線，
     * 已套用的 migration 不得修改（§4.1），只能再加一支 `ALTER` 並轉換既有資料。
     *
     * 另一條路是規定「`bigint` 主鍵表不進 `audit_logs`」，不採用——那會推翻計畫 §1 的論證本身。
     */
    subjectId: varchar('subject_id', { length: 64 }).notNull(),
    /**
     * 逐欄差異（計畫 §4.2），例如 `[{ "field": "employeeCode", "before": "E001", "after": "E002" }]`。
     *
     * **不存「前後兩包整筆資料」**：那種寫法會把沒改動的欄位一起複製兩份，
     * 而 `employees` 沒改動的欄位裡就有 `identity_number_encrypted`——光是改一個員工編號，
     * 整份身分證資料就跟著進了稽核表，而那正是資料字典明文禁止的。
     * 逐欄的話，只有真的被改到的欄位才有機會進來，且每一欄都會先過欄位政策（計畫 §4.3）。
     * 新增與刪除走同一結構（`before`／`after` 其一為 `null`），讀的人不必先判斷這是哪一種事件。
     *
     * **刻意不掛 `$type`。** `changes` 的結構由 `modules/audit/main/domain/audit-change-set.ts` 定義，
     * 而 `db/schema` 是它的下層——在這裡宣告型別會讓相依方向倒過來，
     * 也會變成同一個結構的第二份定義，兩邊漂移時不會有任何地方變紅。
     */
    changes: json('changes').notNull(),
    /**
     * 生效日；帶生效日的異動才有（部門異動、扣繳方式、投保設定），因此 nullable。
     *
     * `mode: 'string'` 存的就是台北的日曆日 `YYYY-MM-DD`，不做任何換算（§6）。
     * **不能用預設的 `mode: 'date'`**：那會在驅動層把值轉成 JS `Date`，
     * 而 `Date` 一定帶時區——換算一旦進到流程裡，就有漏換算與換錯方向的可能，
     * 而錯的形式是「日期差一天」，只在月底與跨日邊界發作。
     */
    effectiveDate: date('effective_date', { mode: 'string' }),
    /**
     * 建立時間，**即資料字典所稱的「操作時間」**（計畫 §3.3）。
     * datetime 一律 `mode: 'string'`，存的就是台北牆鐘時間，不做任何換算（§6）。
     *
     * **不另設 `occurred_at`。** 稽核與業務在同一個交易內寫入（計畫 §5），
     * 「操作發生的時刻」與「這一列被建立的時刻」必然相同。兩個時間欄位並存的話，
     * 「哪一個才是真正的操作時間」會變成每次讀稽核都要重新想一次的問題，而它沒有意義。
     */
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    /*
     * **這裡刻意沒有 `updated_at`，也沒有 `deleted_at`**（計畫 §3.4）。
     *
     * 不是漏了：稽核紀錄一旦寫入就不得修改或刪除（§5.3），有這兩欄就等於在 schema 上
     * 宣告「這筆可以改」——而下一個人看到別的表都有、這張沒有，第一個念頭會是補上去。
     * 通用規範 §1.4 的補集已經寫明本表屬於哪一類：append-only 的事件流水表只需 `created_at`，
     * 且**不得**有 `updated_at` 與 `deleted_at`。
     *
     * 配套（不在本檔）：service 層不提供 update／delete 動作；只有 INSERT／SELECT 權限的
     * 資料庫帳號屬於部署層設定，本輪不做（計畫 §8）。
     */
  },
  (table) => [
    /**
     * 「**這筆資料被誰改過**」——本表最主要的用途（計畫 §3.5）。
     *
     * 四段的順序就是查詢條件的順序：先鎖公司範圍，再指定主體（表 ＋ 主鍵），
     * 最後 `created_at` 供時間排序，讓「最近的異動在前」不必額外排序一次。
     */
    index('ix_audit_logs_company_subject').on(table.companyId, table.subjectTable, table.subjectId, table.createdAt),
    /**
     * 「這家公司最近有哪些異動」。同時是 `fk_audit_logs_company` 的支撐索引
     * ——前綴正好是 `company_id`，InnoDB 用得上它，因此不會自動長出一個只有 `(company_id)` 的索引。
     * （自動長出來的索引除了不以 `company_id` 開頭之外還有一個問題：它是隱形的，review 看不見。）
     */
    index('ix_audit_logs_company_created').on(table.companyId, table.createdAt),
    /**
     * 「這個人做過什麼」。同時是下方複合外鍵的支撐索引：前綴
     * `(company_id, actor_company_user_id)` 正是外鍵欄位組，明確建出來，
     * InnoDB 就不會再自動補一個看不見的。
     *
     * 三支索引**全部以 `company_id` 開頭**（§4.5）：所有查詢都必須帶公司範圍，
     * 索引前綴一致才不會有某一支查詢退化成全表掃描，而這張表是會長到千萬列等級的（計畫 §10）。
     */
    index('ix_audit_logs_company_actor').on(table.companyId, table.actorCompanyUserId, table.createdAt),
    /**
     * FK → `companies.id`。
     *
     * **這條在本表不能省，即使下面已經有一條複合外鍵指向 `company_users`。**
     * `refresh_tokens` 與 `company_user_roles` 都省掉了這一條（`company_id` 由複合外鍵間接受約束），
     * 但那兩張表的成員欄位是 `NOT NULL`。本表的 `actor_company_user_id` 可以是 NULL（系統事件），
     * 而 InnoDB 的 MATCH SIMPLE 語意下，複合外鍵只要有任一欄為 NULL 就**整條不檢查**
     * ——於是 `actor_type_code=2` 的每一列，`company_id` 都會完全不受約束，
     * 可以寫進一個不存在的公司。系統事件（例如憑證重用偵測）正是最需要事後追查的那一類。
     */
    foreignKey({ name: 'fk_audit_logs_company', columns: [table.companyId], foreignColumns: [companies.id] }),
    /**
     * **複合外鍵，帶上 `company_id`**（比照 `company_user_roles` 的 `assigned_by`／`revoked_by`
     * 與 `refresh_tokens.company_user_id`，計畫 §3.1）。
     *
     * 單欄 `actor_company_user_id → company_users.id` 的破口在那些檔案的註解裡已經寫過：
     * 一筆「A 公司的稽核紀錄」可以指向 B 公司的成員，而資料庫完全接受——查詢有回資料、
     * 沒有任何錯誤。**稽核紀錄的可信度整個建立在「這個 ID 對得到本公司的人」上面**，
     * 這個破口等於把它拆掉，而且拆掉之後沒有症狀。
     *
     * `actor_type_code=2`（系統）時本欄為 NULL：InnoDB 的 MATCH SIMPLE 語意下，
     * 複合外鍵只要有任一欄為 NULL 就不檢查，因此 NULL 是合法的
     * ——這與 `company_user_roles.revoked_by` 的先例一致。
     */
    foreignKey({
      name: 'fk_audit_logs_actor',
      columns: [table.companyId, table.actorCompanyUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.id],
    }),
  ],
)
