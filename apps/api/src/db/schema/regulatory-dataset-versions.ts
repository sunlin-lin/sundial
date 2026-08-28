/**
 * `regulatory_dataset_versions`：平台共用的政府資料歷史版本與原始 Snapshot
 * （資料字典 `05-regulatory-system.md`「法規四表定案」；實作計畫 `plans/01-regulatory-dataset-versioning.md` §3.2）。
 *
 * **這張表存在的唯一理由**：Payroll 結算時要依「法規適用基準日」取得**當時**的費率與級距，
 * 而政府事後更新不得改寫已結算的結果（資料字典「Payroll 邊界」）。只保存一份「目前值」做不到這件事
 * ——補算去年 12 月的薪資時，那一份值早就被今年的新值覆蓋掉了，而覆蓋不會留下任何痕跡。
 *
 * ## 三件與其他表不同、且都是刻意的事
 *
 * 1. **主鍵是 `BIGINT` AUTO_INCREMENT，不是 uuid**（計畫 §3.2 (a)）——全站第一批，理由見 {@link regulatoryDatasetVersions} 的 `id`。
 * 2. **沒有 `company_id`，因此不進 `CompanyScopedTable`**（計畫 §3.2 (b)）——法規是全國法定值，全平台共用一份。
 *    這件事在 `db/schema/index.ts` 也寫了一次，因為那裡才是下一個人會誤以為「漏加」的地方。
 * 3. **沒有 `updated_at`、`deleted_at`**——版本是 append-only 的事實流水：某一版在某段期間有效，
 *    這件事發生過就不會變。通用規範 §1.4 的補集正是這一類（同 `audit_logs`）。
 *    「政府改了費率」不是 UPDATE，是**新增一個版本**（計畫 §3.1.1「後台調整是新增版本，不是改欄位」）。
 *
 * ## 本表禁止 `SELECT *`（計畫 §3.2 (c)）
 *
 * `raw_data` 是 LONGTEXT。MariaDB 把 LONGTEXT 存在頁外、不選就不讀，所以只要 repository 逐欄列出就沒有代價；
 * 但只要有人寫了一次 `SELECT *`，列版本清單就會順手拖出每一版的完整 Snapshot，
 * 而症狀是「列表偶爾很慢」，不是錯誤——沒有任何測試會因此變紅。
 */
import { bigint, date, datetime, index, int, longtext, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

/**
 * 原始資料格式代碼。
 *
 * **不用 DB ENUM**（通用規範 §1.4，比照 `AuditActorType`）：MariaDB 改 ENUM 要 `ALTER TABLE` 重建，
 * 而政府新開一種下載格式是業務常態，不該變成 DDL 變更。代碼值的唯一來源是這個 const object，DB 端只存整數。
 *
 * 值是整數而不是字串：資料字典把 `raw_format_code` 明訂為 `integer`。
 *
 * **這一欄記的是 `raw_data` 那串位元組原本是什麼格式**，用途是日後重跑解析器時知道該用哪一個 parser
 * ——Snapshot 保存下來卻不知道怎麼解讀它，等於沒保存。五個值對應計畫 §7.0 實地查證到的來源形態：
 * data.gov.tw 的 CSV 與 JSON、行政院公報的 XML、勞動部公告頁的 HTML，
 * 以及人工維護資料集（`dataset_code=10`，§3.1.1）填入的來源說明純文字。
 */
export const RegulatoryRawFormat = {
  /** CSV：data.gov.tw 與財政部下載專區的主要形態。 */
  Csv: 1,
  /** JSON：data.gov.tw metadata API 與部分資源。 */
  Json: 2,
  /** XML：行政院公報全文。 */
  Xml: 3,
  /** HTML：勞動部最低工資公告頁這類只有網頁可爬的來源。 */
  Html: 4,
  /** 純文字：人工維護資料集填入的來源說明（`dataset_code=10`，計畫 §3.1.1）。 */
  Text: 5,
} as const

export type RegulatoryRawFormatValue = (typeof RegulatoryRawFormat)[keyof typeof RegulatoryRawFormat]

export const regulatoryDatasetVersions = mysqlTable(
  'regulatory_dataset_versions',
  {
    /**
     * 主鍵。**`BIGINT` AUTO_INCREMENT，這是全站第一批不用 uuid 的表**（計畫 §3.2 (a)）。
     *
     * 資料字典就是這樣定的，而理由站得住：本表與 `regulatory_records`、`regulatory_sync_logs` 是
     * **平台全域**資料（不屬於任何公司）、只增不改，而 `regulatory_records` 的列數會到
     * 「數千 × 版本數」。uuid 主鍵的三個好處在這裡一個都用不到——
     * 不需要在客戶端先產生 ID、不需要隱藏列數、不會有跨公司合併資料的需求
     * ——剩下的就只有 CHAR(36) 對 BIGINT 的 36 bytes 換 8 bytes，而且每一支二級索引都要多背一次。
     *
     * `mode: 'number'` 而不是 `'bigint'`：後者在 TypeScript 端是 `bigint`，
     * 而 `JSON.stringify` 對 `bigint` 直接**拋例外**，於是每一支回傳版本 ID 的端點都要記得先轉字串。
     * AUTO_INCREMENT 的值不可能接近 `Number.MAX_SAFE_INTEGER`（2^53，約 9×10^15），
     * 用 `number` 沒有精度風險。
     *
     * 寫進 `audit_logs.subject_id` 時是**十進位字串**（見 `audit-logs.ts` 的 `subjectId`）。
     */
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    /**
     * 法規資料集代碼，合法值見 `modules/regulatory/datasets/domain/regulatory-dataset-code.ts`（計畫 §3.1）。
     *
     * **一旦有版本資料寫進去就不能改**：改了等於歷史資料指向另一個資料集，而且不會有任何地方報錯
     * ——假設 `4` 與 `5` 對調，Payroll 算勞保時拿到的是健保費率，算出一個看起來完全正常的保費，
     * 要到有人核對薪資單才會發現，而那時已經結算好幾期。守這件事的是掃描器 `check:dataset-code`（§3.1.2），
     * 不是註解。
     *
     * **刻意不掛 `$type`**（同 `audit_logs.subject_table` 的處置）：合法值的唯一來源在 `modules/` 底下，
     * 而 `db/schema` 是它的下層。在這裡宣告型別會讓相依方向倒過來，也會變成同一份清單的第二份定義。
     */
    datasetCode: int('dataset_code').notNull(),
    /**
     * 西元版本代碼，例如 `2026-01`。同一個資料集內不重複（見下方 `uq_regulatory_dataset_versions_code`）。
     *
     * **它不保證 `effective_from` 不重複**，這一點對 `resolve` 的排序很關鍵，理由寫在下方索引註解。
     */
    versionCode: varchar('version_code', { length: 30 }).notNull(),
    /**
     * 版本生效日。
     *
     * `mode: 'string'` 存的就是台北的日曆日 `YYYY-MM-DD`，不做任何換算（§6）。
     * **不能用預設的 `mode: 'date'`**：那會在驅動層轉成 JS `Date`，而 `Date` 一定帶時區
     * ——換算一旦進到流程裡就有漏換算與換錯方向的可能，而錯的形式是「日期差一天」，
     * 對法規版本而言那就是「跨年那一天用錯版本」。
     *
     * 推導不出生效日時**一律讓同步失敗，不得猜**（計畫 §7.2）：不得以同步當天、上一版生效日
     * 或任何推測值 fallback。任何日期看起來都是合理的日期，沒有一個斷言能說它不對。
     */
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    /**
     * 版本失效日。**只在「政府明示失效日」時才寫入**（計畫 §3.2 (d)）。
     *
     * **不拿來記「下一版開始日的前一天」**，這是本表最容易寫錯的地方。資料字典寫 `effective_to`
     * 「可由下一版本推導」——**推導，不是寫入**。如果新增一版時要順手 UPDATE 前一版的 `effective_to`，
     * 那個 UPDATE 漏掉不會有任何錯誤，只會讓兩個版本同時宣稱自己在某一天有效，
     * 而 `resolve` 挑到哪一版取決於 `ORDER BY` 的巧合。
     *
     * 因此絕大多數列的這一欄是 NULL，而解析查詢固定長這樣、永遠只回一筆（計畫 §3.2）：
     *
     * ```sql
     * WHERE dataset_code = ?
     *   AND effective_from <= :asOfDate
     *   AND (effective_to IS NULL OR effective_to >= :asOfDate)
     * ORDER BY effective_from DESC, id DESC
     * LIMIT 1
     * ```
     */
    effectiveTo: date('effective_to', { mode: 'string' }),
    /**
     * 本次取得的政府資源識別碼。**不視為永久固定 URL**（資料字典明文）。
     *
     * 每次同步都要先打 data.gov.tw 的 metadata API 重新探索資源網址（計畫 §7.0）：
     * 實測勞動部的資源網址帶隨機尾碼（`A17000000J-020014-Uy8`），硬編一定會壞。
     * 這一欄記的是「這一版當時是從哪個資源抓到的」，供事後追查，不是下次要去打的位址。
     */
    governmentResourceId: varchar('government_resource_id', { length: 150 }),
    /**
     * 政府來源標示的修改時間；選填（不是每個來源都有）。
     *
     * datetime 一律 `mode: 'string'`，存的就是台北牆鐘時間（§6）。**來源的時區未必是台北**，
     * 一律在解析階段轉成台北再寫入；轉換規則寫在各資料集的解析器裡，不是寫在資料表上（計畫 §3.2）
     * ——寫在表上的話，每個解析器都要記得自己有沒有轉過，而漏轉的症狀是時間差 8 小時、不報錯。
     */
    sourceModifiedAt: datetime('source_modified_at', { mode: 'string' }),
    /** 同步完成時間。台北牆鐘時間，不做任何換算（§6）。 */
    syncedAt: datetime('synced_at', { mode: 'string' }).notNull(),
    /**
     * 原始內容雜湊，用於判斷內容是否改變（相同即 `status_code=4 無異動`，計畫 §7.1）。
     *
     * 長度 128 與資料字典一致，容得下 SHA-512 的十六進位字串。
     */
    checksum: varchar('checksum', { length: 128 }).notNull(),
    /** 解析後筆數；選填（同步失敗或尚未解析時沒有值）。 */
    recordCount: int('record_count'),
    /** 原始資料格式，見 {@link RegulatoryRawFormat}。 */
    rawFormatCode: int('raw_format_code').$type<RegulatoryRawFormatValue>().notNull(),
    /**
     * 政府原始資料 Snapshot。**LONGTEXT，因此本表禁止 `SELECT *`**（計畫 §3.2 (c)，理由見檔頭）。
     *
     * 保存原始位元組而不是只留解析結果，是為了「解析器改了之後可以重跑」：
     * 政府資料格式變動時，沒有 Snapshot 就只能重新去抓，而舊資源網址那時多半已經失效。
     */
    rawData: longtext('raw_data').notNull(),
    /**
     * 建立時間。台北牆鐘時間，不做任何換算（§6）。
     *
     * **與 `synced_at` 不同**，兩者刻意並存：`synced_at` 是「這份政府資料是什麼時候取得的」，
     * `created_at` 是「這一列是什麼時候寫進來的」。匯入 script 補錄歷史版本時兩者會差很多
     * （計畫 §7.0：`2`、`5`、`9` 可以一次回補十幾年的歷史版本）。
     */
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    /*
     * **這裡刻意沒有 `is_current`**（資料字典明確把它列在「被推翻方案」）。
     *
     * 「目前版本」由生效區間判定，不由旗標判定。旗標的失敗模式是：新增一版時要把舊版的旗標關掉，
     * 那個 UPDATE 漏掉就會有兩版同時是「目前」，而漏掉不會報錯。更根本的是**旗標答不出
     * 「去年 12 月適用的是哪一版」**，而那正是 Payroll 補算時唯一會問的問題。
     *
     * **也刻意沒有 `updated_at`、`deleted_at`**（見檔頭第 3 點）。
     */
  },
  (table) => [
    /**
     * 資料字典的約束：同一資料集內版本代碼不重複。
     *
     * **它只保證版本代碼不重複，完全不保證 `effective_from` 不重複**（計畫 §3.2 (d)）：
     * 版本補錄、或 checksum 誤判導致同一份資料重新寫成新版本，都會產生兩筆同日生效的紀錄。
     * 因此 `resolve` 的 `ORDER BY` 必須帶次要排序鍵 `id DESC`（語意是「同日生效時，後寫入的版本優先」），
     * 那不是保險，是必要的：少了它，挑到哪一筆由實體儲存順序與執行計畫決定
     * ——這次跑出版本 A，重建索引或升級 MariaDB 之後跑出版本 B，兩版的費率都是正常數字，
     * 沒有錯誤訊息，而且不可重現。
     */
    uniqueIndex('uq_regulatory_dataset_versions_code').on(table.datasetCode, table.versionCode),
    /**
     * `resolve`（依基準日取適用版本）的唯一熱點（計畫 §3.2）。
     *
     * 兩段的順序就是查詢條件的順序：先鎖資料集，再以 `effective_from` 做範圍比較與遞減排序。
     * 這支查詢是 Payroll **每算一個人的每一種保險**都會打一次的查詢，退化成全表掃描不會有錯誤，
     * 只會讓結算愈跑愈慢。
     *
     * 本表**沒有**以 `company_id` 開頭的索引（§4.5 那條規則的前提是「帶 `company_id` 的表」），
     * 因為它根本沒有那一欄——見檔頭第 2 點。
     */
    index('ix_regulatory_dataset_versions_effective').on(table.datasetCode, table.effectiveFrom),
  ],
)
