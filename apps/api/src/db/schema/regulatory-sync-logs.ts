/**
 * `regulatory_sync_logs`：每次自動排程或人工同步的結果
 * （資料字典 `05-regulatory-system.md`；實作計畫 `plans/01-regulatory-dataset-versioning.md` §3.4）。
 *
 * 資料字典的設計理由：「同步紀錄獨立保存每次下載、驗證與套用結果，讓失敗可追查且不影響已生效資料，
 * 亦不以最後同步時間取代完整歷程」。**不是在版本表上加一個 `last_synced_at`**
 * ——那樣「為什麼那三天沒同步」永遠答不出來，因為失敗的那幾次根本沒有留下任何一列。
 *
 * ## 與資料字典的唯一出入：多一欄 `heartbeat_at`（計畫 §3.4，決策 D2）
 *
 * 這是本計畫對資料字典唯一的欄位增補，補的是字典沒有處理的一個失敗模式：
 * 同步程序被殺掉（部署、OOM、機器重啟）之後，那一筆會永遠停在 `status_code=1 執行中`，
 * 而下一次排程看到「已有執行中的同步」就會跳過——**從此再也不同步，且沒有任何錯誤**：
 * 沒有失敗紀錄、沒有告警，log 裡只有一筆安靜的「執行中」。要到政府調了費率、
 * 系統還在用舊版才會發現。判定規則見 {@link regulatorySyncLogs} 的 `heartbeatAt`。
 *
 * 沒有 `company_id`（平台全域，見 `regulatory-dataset-versions.ts` 檔頭）。
 *
 * ## 本表**有** `created_at` ＋ `updated_at`，與同批另外兩張表不同
 *
 * `regulatory_dataset_versions` 與 `regulatory_records` 是 append-only（寫入之後永遠不會被修改），
 * 因此適用通用規範 §1.4 的補集，只有 `created_at`。**本表不在那個補集裡**：它的列會被 UPDATE
 * ——`status_code` 由 1 變成 2／3／4、`heartbeat_at` 每 60 秒一次、`finished_at` 在結束時寫入。
 * 判準是純機械的「這張表的列在寫入之後會不會被修改」，本表的答案是「會」，於是 §1.4 的
 * 「主檔表必備 `created_at`、`updated_at`」照常適用。理由與三個時間欄位的分工見
 * {@link regulatorySyncLogs} 的 `updatedAt`。
 *
 * 沒有 `deleted_at`：同步歷程不刪除。「為什麼那三天沒同步」的線索一旦可以被刪掉，這張表就白建了。
 */
import { bigint, datetime, foreignKey, index, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core'
import { regulatoryDatasetVersions } from './regulatory-dataset-versions.ts'

/**
 * 同步觸發方式代碼。**不用 DB ENUM**（通用規範 §1.4），代碼值的唯一來源是這個 const object。
 *
 * 兩者必須分得出來：排程失敗要進告警，人工觸發失敗是操作者當場就看得到的事。
 * （人工觸發的端點 `/regulatory/sync/trigger` 目前刻意不開放，見計畫 D3——按一次會影響全平台
 * 每一家公司的 Payroll 版本，而目前沒有平台管理員這個角色。代碼值先留著，因為
 * 匯入 script 在伺服器上跑的那條路徑就是「人工」。）
 */
export const RegulatorySyncTriggerType = {
  /** 自動排程。 */
  Scheduled: 1,
  /** 人工觸發（目前只有伺服器端的匯入 script）。 */
  Manual: 2,
} as const

export type RegulatorySyncTriggerTypeValue = (typeof RegulatorySyncTriggerType)[keyof typeof RegulatorySyncTriggerType]

/**
 * 同步狀態代碼。**不用 DB ENUM**（通用規範 §1.4），代碼值的唯一來源是這個 const object。
 *
 * 四個值來自資料字典，逐一都有事後追查上的意義，不可合併：
 *
 * - `Running` 是唯一一個「還沒有結論」的狀態，也是心跳機制唯一的守備範圍。
 * - `NoChange` 與 `Succeeded` 分開，是因為「跑了但政府沒改」與「跑了而且寫入新版本」在
 *   「為什麼沒有新版本」這個問題上答案完全不同。合併成「成功」之後，
 *   那個問題就只能靠比對版本表才回答得出來。
 * - `Failed` 必須留下來（配 `error_message`），這是計畫 §7.2「推導不出生效日一律失敗，不得猜」
 *   的落點：寧可有一筆失敗紀錄讓人去看，也不要一個安靜生效的錯誤版本。
 */
export const RegulatorySyncStatus = {
  /** 執行中。心跳逾時判定的對象，見 `heartbeatAt`。 */
  Running: 1,
  /** 更新成功（已寫入新版本）。 */
  Succeeded: 2,
  /** 失敗。此時 `error_message` 必填（應用層保證）。 */
  Failed: 3,
  /** 無異動（checksum 與該資料集最新版本相同）。 */
  NoChange: 4,
} as const

export type RegulatorySyncStatusValue = (typeof RegulatorySyncStatus)[keyof typeof RegulatorySyncStatus]

export const regulatorySyncLogs = mysqlTable(
  'regulatory_sync_logs',
  {
    /** 主鍵。`BIGINT` AUTO_INCREMENT，理由見 `regulatory-dataset-versions.ts` 的 `id`。 */
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    /**
     * 本次同步的法規資料集代碼。合法值見
     * `modules/regulatory/datasets/domain/regulatory-dataset-code.ts`（計畫 §3.1）。
     *
     * **刻意不掛 `$type`**，理由同 `regulatory_dataset_versions.dataset_code`：
     * 清單的唯一來源在 `modules/` 底下，`db/schema` 是它的下層，在這裡宣告會讓相依方向倒過來。
     *
     * **也刻意不設外鍵指向版本表的 `dataset_code`**：同步失敗時本表要留下紀錄，
     * 而那正是「這個資料集一個版本都還沒有」的情況——有外鍵的話，第一次失敗就寫不進去，
     * 於是最需要留紀錄的那一次反而沒有紀錄。
     */
    datasetCode: int('dataset_code').notNull(),
    /** 觸發方式，見 {@link RegulatorySyncTriggerType}。 */
    triggerTypeCode: int('trigger_type_code').$type<RegulatorySyncTriggerTypeValue>().notNull(),
    /** 同步開始時間。台北牆鐘時間，不做任何換算（§6）。 */
    startedAt: datetime('started_at', { mode: 'string' }).notNull(),
    /** 同步結束時間；`status_code=1 執行中`時為 NULL。 */
    finishedAt: datetime('finished_at', { mode: 'string' }),
    /** 同步狀態，見 {@link RegulatorySyncStatus}。 */
    statusCode: int('status_code').$type<RegulatorySyncStatusValue>().notNull(),
    /**
     * 本次成功產生／辨識出的版本。FK → `regulatory_dataset_versions.id`
     * （見下方 `fk_regulatory_sync_logs_version`）。
     *
     * 失敗與執行中時為 NULL；`status_code=4 無異動`時指向**既有的**那一版
     * ——「這次同步確認了現行版本仍然是最新的」，那個資訊比 NULL 有用。
     */
    datasetVersionId: bigint('dataset_version_id', { mode: 'number' }),
    /** 本次實際使用的政府資源識別碼。失敗時特別有用：resource discovery 抓到的是哪一個。 */
    governmentResourceId: varchar('government_resource_id', { length: 150 }),
    /** 本次收到／解析筆數；選填（在解析之前就失敗時沒有值）。 */
    recordsReceived: int('records_received'),
    /**
     * 失敗原因。`status_code=3` 時必填（應用層保證，資料庫層是 nullable——
     * 「條件必填」在 DDL 上寫不出來，同 `audit_logs.actor_company_user_id` 的處置）。
     *
     * 心跳逾時被判死的那一筆也要寫進這裡（見 `heartbeatAt`），不是靜靜略過。
     */
    errorMessage: text('error_message'),
    /**
     * 同步程序存活訊號。**資料字典沒有這一欄，是本計畫唯一的欄位增補**（計畫 §3.4、決策 D2）。
     *
     * 判定規則（三條一起才成立）：
     *
     * 1. 執行中的同步**每 60 秒**更新一次本欄。
     * 2. 下一次同步啟動時，若同一 `dataset_code` 有 `status_code=1` 且 `heartbeat_at`
     *    落後**超過 3 分鐘**（三個心跳週期），視為該程序已死。
     * 3. **視為死亡時要把它改成 `status_code=3 失敗` 並寫入 `error_message`（心跳逾時），
     *    不是直接忽略**——資料字典要求「獨立保存每次下載、驗證與套用結果」，
     *    靜靜略過等於少了一次失敗紀錄，而那正是事後要查「為什麼那三天沒同步」時唯一的線索。
     *
     * **為什麼是心跳而不是「`started_at` 超過 N 分鐘就當失敗」**：固定逾時要猜一個
     * 「同步最久會跑多久」的數字，猜小了會把還活著的程序判死（於是兩個程序同時寫同一個版本），
     * 猜大了則卡死的紀錄要等很久才會被清掉。心跳量的是「程序還在不在」，不是「跑了多久」，不需要猜。
     *
     * **為什麼是三個週期而不是一個**：漏掉一次心跳可能只是 GC 或 IO 卡住；連續三次沒更新，
     * 程序基本上不可能還活著。
     *
     * **心跳必須由獨立計時器驅動，不得綁在工作步驟上。** 「每完成一個步驟才更新一次」這種寫法
     * 是不合格的實作，即使它看起來達成同樣效果：Bun 是單一事件迴圈，任何一個長步驟
     * ——政府端點回應緩慢的單一 `await fetch()`、或扣繳稅額表（`dataset_code=9`）那種
     * CPU 密集的同步解析——只要超過 180 秒，心跳就不會動。於是一個活得好好的程序被判死，
     * 第二個程序接手同時寫入；若兩者算出的 `version_code` 不同，就會產生兩個並存的合法版本，
     * 直接餵給計畫 §3.2 的排序問題。
     *
     * **必填**：允許 NULL 的話，判定就得多寫一條「NULL 算不算逾時」，而漏寫那一條的後果，
     * 正好是這一欄要防的那個狀態（永遠停在執行中）。建立紀錄時與 `started_at` 同值。
     */
    heartbeatAt: datetime('heartbeat_at', { mode: 'string' }).notNull(),
    /** 建立時間，即這次同步被登記的時刻。台北牆鐘時間，不做任何換算（§6）。 */
    createdAt: datetime('created_at', { mode: 'string' }).notNull(),
    /**
     * 這一列最後被寫入的時刻。台北牆鐘時間，不做任何換算（§6）。
     *
     * ## 本表有三個「最近一次」性質的時間欄位，語意各不相同
     *
     * | 欄位 | 回答的問題 |
     * |---|---|
     * | `heartbeat_at` | **同步程序還活著嗎**——只在 `status_code=1` 期間由獨立計時器推進 |
     * | `finished_at` | **這次同步是什麼時候結束的**——只在轉成 2／3／4 那一刻寫入，之後不再變 |
     * | `updated_at` | **這一列最後被寫是什麼時候**——任何一次 UPDATE 都推進 |
     *
     * 三者確實**語意重疊**：正常流程下 `updated_at` 的值不是等於 `heartbeat_at`（執行中）
     * 就是等於 `finished_at`（已結束），它不會提供前兩欄答不出來的資訊。
     *
     * **即使如此仍然保留，理由不在這一欄的用途，而在規則的形狀**：通用規範 §1.4 是
     * 「主檔表必備 `created_at`、`updated_at`」，其補集只豁免 **append-only** 的表
     * ——判準是純機械的「這張表的列在寫入之後會不會被修改」。本表的列**會**被修改
     * （`status_code`、`heartbeat_at`、`finished_at`），因此它不在補集裡，規則照常適用。
     *
     * 反過來說，如果為它開一個「狀態變更已由具名欄位完整表達，故可免 `updated_at`」的例外，
     * 那條規則就從機械判定退化成需要判斷——而「這張表的狀態變更算不算已被完整表達」
     * 沒有標準答案，下一張表就會有人給出不同答案，然後兩張表的欄位長得不一樣而誰都說得通。
     * 通用規範 §7.6（全稱規則的定義域必須可判定）要防的正是這個。
     * **一個略顯冗餘的欄位，比一條邊緣模糊的規則便宜。**
     *
     * 實務上的讀法：要判斷程序死活看 `heartbeat_at`（那是唯一有此語意的欄位，
     * 判定規則見上一欄），要看這次同步跑多久看 `finished_at - started_at`。
     * `updated_at` 是給「這一列到底有沒有被動過」這種一般性問題用的，不進任何業務判定。
     *
     * **沒有 `deleted_at`**：同步歷程不刪除，見檔頭。
     */
    updatedAt: datetime('updated_at', { mode: 'string' }).notNull(),
  },
  (table) => [
    /**
     * 同步歷程列表（`/regulatory/sync/list`，計畫 §4.2）的支撐索引：
     * 「這個資料集最近幾次同步的結果」。兩段的順序就是查詢條件的順序
     * ——先鎖資料集，再由 `started_at` 遞減排序，不必額外排序一次。
     */
    index('ix_regulatory_sync_logs_dataset_started').on(table.datasetCode, table.startedAt),
    /**
     * 心跳逾時判定（見 `heartbeatAt`）的支撐索引：
     * 「這個資料集有沒有 `status_code=1` 且 `heartbeat_at` 落後超過 3 分鐘的紀錄」。
     *
     * 這支查詢**每次同步啟動時都會先跑一次**，而且它是同步流程的第一步——它慢，
     * 每一次同步都跟著慢。三段順序即條件順序：資料集 → 狀態 → 心跳時間比較。
     */
    index('ix_regulatory_sync_logs_dataset_status').on(table.datasetCode, table.statusCode, table.heartbeatAt),
    /**
     * FK → `regulatory_dataset_versions.id`。
     *
     * 這一條需要自己的支撐索引：`dataset_version_id` 不是上面任何一支索引的前綴，
     * 不明確建出來的話 InnoDB 會自動補一個——而自動補的索引在 review 上是隱形的
     * （同 `audit_logs` 與 `employees` 的處置）。
     */
    index('ix_regulatory_sync_logs_version').on(table.datasetVersionId),
    foreignKey({
      name: 'fk_regulatory_sync_logs_version',
      columns: [table.datasetVersionId],
      foreignColumns: [regulatoryDatasetVersions.id],
    }),
  ],
)
