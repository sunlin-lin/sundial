/**
 * `regulatory_records`：政府原始資料解析後、供 Payroll 查詢的標準化資料
 * （資料字典 `05-regulatory-system.md`；實作計畫 `plans/01-regulatory-dataset-versioning.md` §3.3）。
 *
 * 一個版本（`regulatory_dataset_versions` 的一列）底下掛多筆 record：一張投保薪資分級表有幾十級，
 * 一張職業災害保險行業別費率表有上百個行業別，每一級／每一個行業別就是這裡的一列。
 *
 * ## 為什麼有一個通用的 `data` 欄，而不是每個資料集各拆一張表
 *
 * 資料字典的理由：「通用 `data` 欄先承載不同資料集結構，可在未確認專屬欄位前避免過早拆出錯誤 Schema」。
 * 十個資料集的形狀差異很大（分級表是級距、費率表是行業別對費率、扣繳稅額表是二維表），
 * 現在就各拆一張表，等於在只看過其中兩三個真實資料的情況下決定其餘七個的欄位。
 *
 * 代價是 `data` 在資料庫層沒有型別，因此**型別在程式端收斂**：一個 `dataset_code` 對應一個 TypeBox schema
 * （`datasets/domain/regulatory-record-shape.ts`），**寫入前驗證、讀出後也驗證**（計畫 §6）。
 * 讀出後也驗證看起來多餘，但它擋的是另一件事：資料是幾個月前由**另一版程式**寫進去的
 * ——解析器改過、欄位名改過、政府資料格式變過，寫入時的驗證管不到已經在庫裡的資料。
 *
 * ## 金額與費率一律 DECIMAL，程式端禁止退化成 `number`
 *
 * `range_from`／`range_to`／`amount`／`rate` 四欄都是 DECIMAL，Drizzle 讀出來是**字串**，
 * 而 §4.7 禁止 `Number(...)` 之後再計算。這不是通則的複述——規範 §4.7 逐字點名的就是這個場景：
 *
 * > 浮點誤差在薪資單上就是實發金額差一塊錢對不起來，而**勞健保級距在邊界值上會選錯級距**，錯的是法定金額。
 *
 * 級距比對是「這個投保薪資落在 `range_from` 與 `range_to` 之間嗎」——邊界值正好等於級距上限時，
 * 浮點誤差會讓它掉到下一級。**保費差幾百塊，而薪資單上完全看不出異常。**
 *
 * 沒有 `company_id`（平台全域資料，見 `regulatory-dataset-versions.ts` 檔頭），
 * 也沒有 `updated_at`／`deleted_at`（append-only，通用規範 §1.4 的補集）。
 */
import { bigint, datetime, decimal, foreignKey, index, int, json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { regulatoryDatasetVersions } from './regulatory-dataset-versions.ts'

export const regulatoryRecords = mysqlTable(
  'regulatory_records',
  {
    /**
     * 主鍵。`BIGINT` AUTO_INCREMENT，理由見 `regulatory-dataset-versions.ts` 的 `id`
     * ——而本表是那段理由裡列數最大的一張：「數千 × 版本數」。
     */
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    /**
     * 所屬版本。FK → `regulatory_dataset_versions.id`（見下方 `fk_regulatory_records_version`）。
     *
     * **record 一律綁在版本上，不綁在 `dataset_code` 上**：這是「政府後續更新不得改寫已結算結果」
     * 的落點。若 record 只認資料集，同步新資料時就得先刪掉舊的一批再寫新的，
     * 而已結算 Payroll 引用的那一版就跟著消失了。
     */
    datasetVersionId: bigint('dataset_version_id', { mode: 'number' }).notNull(),
    /**
     * 同一版本內穩定且唯一的資料鍵（見下方 `uq_regulatory_records_key`）。
     *
     * 「穩定」指的是**同一筆法規內容在不同版本之間應該得到同一個 key**（例如投保薪資的第 5 級、
     * 行業別代碼 `0101`），這樣「這一級在新版變成多少」才比對得出來。
     * 用政府資料裡既有的識別字串，不要用「第幾列」——列的順序政府隨時會改，而改了不會有任何錯誤。
     */
    recordKey: varchar('record_key', { length: 150 }).notNull(),
    /** 業務代碼（行業別代碼、級數這類），選填：不是每個資料集都有。 */
    code: varchar('code', { length: 100 }),
    /** 顯示名稱（行業別名稱這類），選填。 */
    name: varchar('name', { length: 250 }),
    /**
     * 級距下限。**DECIMAL(18,4)，讀出來是字串，禁止 `Number(...)` 後再計算**（§4.7，理由見檔頭）。
     *
     * `mode: 'string'` 明確寫出來而不是靠預設：預設值哪天變了不會有任何地方變紅，
     * 而症狀是金額悄悄變成 float。
     */
    rangeFrom: decimal('range_from', { precision: 18, scale: 4, mode: 'string' }),
    /** 級距上限。同 `range_from`：DECIMAL、字串、禁止轉 `number`。 */
    rangeTo: decimal('range_to', { precision: 18, scale: 4, mode: 'string' }),
    /** 金額或計算基礎值。同上：DECIMAL、字串、禁止轉 `number`。 */
    amount: decimal('amount', { precision: 18, scale: 4, mode: 'string' }),
    /**
     * 費率／比率。DECIMAL(18,8)——比金額多四位小數是資料字典定的，而且用得上：
     * 補充保險費率 `0.0211`、勞退提繳率這類值在千分位以下仍有意義。同上禁止轉 `number`。
     */
    rate: decimal('rate', { precision: 18, scale: 8, mode: 'string' }),
    /**
     * 無法由上面通用欄位承載的完整標準化內容（計畫 §6）。
     *
     * **刻意不掛 `$type`**（同 `audit_logs.changes` 的處置）：`data` 的形狀由
     * `modules/regulatory/datasets/domain/regulatory-record-shape.ts` 逐 `dataset_code` 定義，
     * 而 `db/schema` 是它的下層——在這裡宣告型別會讓相依方向倒過來，也會變成同一組結構的第二份定義。
     *
     * **不能讓 `data` 以 `unknown` 流進 Payroll**（計畫 §6）：那等於把型別檢查的邊界推進薪資計算裡面。
     * 收斂的位置是 domain 的 TypeBox schema，不是這裡。
     */
    data: json('data').notNull(),
    /** 同版本內的顯示／運算順序，選填。政府資料的原始列序放這裡，供還原成人看得懂的表格。 */
    sortOrder: int('sort_order'),
    /** 建立時間。台北牆鐘時間，不做任何換算（§6）。 */
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 資料字典的約束：同一版本內 `record_key` 不重複。
     *
     * 同時是下方外鍵的支撐索引：前綴正好是 `dataset_version_id`，InnoDB 用得上它，
     * 因此不會自動長出一個看不見的單欄索引（自動長出來的索引在 review 上是隱形的）。
     */
    uniqueIndex('uq_regulatory_records_key').on(table.datasetVersionId, table.recordKey),
    /**
     * 級距查詢的支撐索引（計畫 §3.3）：「給一個投保薪資，找出它落在第幾級」。
     *
     * 這是本表的熱點，而且是 **Payroll 每算一個人就會打一次**的查詢——一次結算 300 人、
     * 每人四種保險，就是 1,200 次。退化成全表掃描不會有錯誤，只會讓結算隨著版本累積愈跑愈慢。
     */
    index('ix_regulatory_records_range').on(table.datasetVersionId, table.rangeFrom, table.rangeTo),
    /**
     * FK → `regulatory_dataset_versions.id`。
     *
     * 版本被刪掉時不連動刪除（`NO ACTION`，全站一致）：本表與版本表都是 append-only，
     * 正常流程裡沒有刪除；真的有人手動刪版本時，外鍵擋下來遠比靜靜刪掉一批 record 好
     * ——那批 record 正是已結算 Payroll 引用的東西。
     */
    foreignKey({
      name: 'fk_regulatory_records_version',
      columns: [table.datasetVersionId],
      foreignColumns: [regulatoryDatasetVersions.id],
    }),
  ],
)
