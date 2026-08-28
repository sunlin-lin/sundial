/**
 * `dataset_code` 的清單（實作計畫 `docs/plans/01-regulatory-dataset-versioning.md` §3.1，決策 D1）。
 *
 * ## 這一份的唯一來源是計畫 §3.1 的表格，不是這個檔案
 *
 * 計畫 §3.1 明寫「本清單即為唯一來源」，本檔必須與它**逐項一致**，
 * 並由 `bun run check:dataset-code` 掃描比對（§3.1.2）——每一組「代碼 ↔ 名稱」對不上就失敗。
 * 因此 {@link REGULATORY_DATASETS} 的 `name` **必須與那張表逐字相同**，不得為了好讀而潤飾。
 *
 * ## 為什麼要有掃描器，而不是在這裡寫一句「請保持一致」
 *
 * `dataset_code` 一旦有版本資料寫進去就不能改：改了等於歷史資料指向另一個資料集，
 * 而且不會有任何地方報錯。假設 `4`（勞就保保險費分擔金額表）與 `5`（健保費負擔金額表）對調，
 * Payroll 算勞保時拿到的是健保的分擔金額，算出一個**看起來完全正常**的保費，
 * 要到有人核對薪資單才會發現，而那時已經結算好幾期。
 *
 * 具體會怎麼失守（計畫 §3.1.2 的原文）：有人整理常數檔時把列舉值改成按字母排序，`4` 與 `5` 對調，
 * PR 描述寫「僅整理常數排序，無邏輯變更」——這種 PR 幾乎必然被放行。
 * 而資料庫裡既有的資料**不會跟著改**。
 *
 * ## `7` 是空號，不是漏打
 *
 * `7` 原為「投保單位類別」，已確認不需要（本系統的使用者都是公司行號）。
 * **編號不遞補、永久保留空號**，因此 `7` 不出現在下面的物件裡。
 *
 * 遞補的成本看不見但是實的：這份清單有一份在文件、一份在這裡、日後還有一份在資料庫。
 * 遞補會製造出「舊文件的 `8` 是最低工資、新文件的 `8` 是扣繳稅額表」，
 * 而那正是上一段那個失敗模式本身。留一個空號零成本。
 *
 * 連帶：`company_regulatory_settings.insurance_unit_type_code` 那一欄日後也不需要
 * （該表不在本計畫範圍，記在此供日後參考）。
 *
 * ## 本目錄一律零 IO
 *
 * 這裡只有型別與常數，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 * `db/schema` 的 `dataset_code` 欄位**刻意沒有** `$type` 指向這裡：那會讓相依方向倒過來
 * （`db/schema` 是 `modules/` 的下層），理由寫在 `db/schema/regulatory-dataset-versions.ts`。
 */

/**
 * 資料集的維護方式。
 *
 * **這件事寫在程式碼常數裡，不做成資料表欄位**（計畫 §3.1.1）。理由是它**不是資料，是程式的事實**：
 * 「這個資料集有沒有解析器」由 `sync` 次目錄裡有沒有那一支程式決定，而那是編譯期就確定的東西。
 *
 * 做成資料表欄位的話，它會變成一個可以與程式碼不一致的值——有人把 `10` 的維護方式改成 `sync`，
 * 排程就會去找一支不存在的解析器；反過來把 `1` 改成 `manual`，勞保分級表就**從此不再同步**，
 * 而兩種情形都不會有任何地方變紅。放在常數裡，改它就是改程式碼，會經過 review 與 CI。
 */
export const REGULATORY_DATASET_MAINTENANCE = {
  /** 由排程自動同步（`sync` 次目錄，Stage 3）。九項中的八項屬於這一類。 */
  Sync: 'sync',
  /** 人工維護：沒有可用的來源，值由 migration 帶入（目前只有 `10`，計畫 §3.1.1）。 */
  Manual: 'manual',
} as const

export type RegulatoryDatasetMaintenance =
  (typeof REGULATORY_DATASET_MAINTENANCE)[keyof typeof REGULATORY_DATASET_MAINTENANCE]

/**
 * 全部資料集，key 即 `dataset_code`（計畫 §3.1 的表格逐項對應）。
 *
 * 每一項三個欄位：
 *
 * - `key`：程式內部用的穩定識別字串（檔名、解析器命名、log）。**不進資料庫**——
 *   資料庫存的一律是數字代碼；兩個地方都存等於兩份真相，而它們哪天不一致不會有任何地方變紅。
 * - `name`：計畫 §3.1 表格的資料集名稱，**逐字一致**（見檔頭，`check:dataset-code` 會比對）。
 * - `maintenance`：見 {@link REGULATORY_DATASET_MAINTENANCE}。
 *
 * **`4` 與 `5` 是「金額表」不是「費率表」，這是刻意的**（計畫 §3.1）：政府直接發分擔金額表，
 * 每一級要繳多少錢都算好了。查表比自己乘費率好，而且不只是省事——原本「勞保費率」那一格有一個
 * 會出事的坑：`6259` 的資源說明寫「自 115/1/1 起適用」，但 11.5% 這個費率實際自 **114/1/1** 起生效，
 * 說明講的是分擔金額表的適用日。照那個日期建版本，114 年整年的結算會抓到錯的版本邊界。
 *
 * **`6` 為什麼做成資料集而不是程式常數**（計畫 §3.1）：行業別代碼政府會改。做成常數的話每次改都要發版，
 * 而且舊資料會失去它當時對應的名稱——`company_regulatory_settings` 存的是代碼，
 * 代碼的意義換了，歷史就跟著被改寫。
 */
export const REGULATORY_DATASETS = {
  /** 來源：data.gov.tw `6258`。生效日就在每一筆資料的 `適用起日` 欄位裡（民國 YYYMMDD）。 */
  1: { key: 'labor-insurance-salary-grades', name: '勞工保險投保薪資分級表', maintenance: 'sync' },
  /** 來源：data.gov.tw `20251`（16 個歷史版本）。生效日在資源名稱（「115年1月…」）。 */
  2: { key: 'health-insurance-salary-grades', name: '全民健康保險投保金額分級表', maintenance: 'sync' },
  /** 來源：data.gov.tw `6274` ＋ 歷年版 `13335`。生效日就在資料的 `生效日` 欄位裡。 */
  3: { key: 'labor-pension-contribution-wage-grades', name: '勞工退休金月提繳工資分級表', maintenance: 'sync' },
  /** 來源：data.gov.tw `6259`（含就業保險 1%）。生效日在資源說明——注意檔頭提到的 114／115 坑。 */
  4: { key: 'labor-employment-insurance-premium-shares', name: '勞就保保險費分擔金額表', maintenance: 'sync' },
  /** 來源：data.gov.tw `20246`（19 個歷史版本，回溯到民國 100 年）。生效日在資源名稱。 */
  5: {
    key: 'health-insurance-premium-shares-employed',
    name: '健保費負擔金額表（有一定雇主之受僱者）',
    maintenance: 'sync',
  },
  /** 來源：data.gov.tw `6262`。生效日在資源說明（「114年1月1日起適用」）。 */
  6: { key: 'occupational-accident-insurance-industry-rates', name: '職業災害保險行業別費率', maintenance: 'sync' },
  /*
   * `7` 是空號，**刻意不出現在這個物件裡**，理由見檔頭「`7` 是空號，不是漏打」。
   * 這一段註解本身就是它的紀錄：沒有它，下一個人看到 1–6 接 8 的第一個念頭是補一個 `7`，
   * 而補進去就等於把 `8`、`9`、`10` 的意義往後推一格。
   */
  /**
   * 來源：勞動部公告頁（純文字條列），或行政院公報 XML。生效日在公告內文（「自115年1月1日起實施」）。
   *
   * **不要用 data.gov.tw `6281`「基本工資之制定與調整經過」**（計畫 §7.0）：它有乾淨的 `實施日期` 欄位，
   * 看起來是最理想的來源，但內容停在 113 年施行的 183 元，缺 114、115 兩次調整，
   * 而 `modifiedDate` 仍顯示 2026-06-22——自動同步會成功、會拿到一個完全合理的舊值、不會報任何錯。
   * 這比沒有資料更危險，因為錯誤是靜默的。
   */
  8: { key: 'minimum-wage', name: '最低工資（月薪與時薪）', maintenance: 'sync' },
  /**
   * 來源：財政部臺北國稅局 Open Data 下載專區（**不是** data.gov.tw `25627`）。
   * 生效日取自列表頁的年度標示（連結文字 `…薪資所得扣繳稅額表_115年度.csv`），涵蓋 107–115（110 缺）。
   *
   * 開放平臺那一份的 title／description／資源名稱／`coverageStartedDate` **四處都沒有年度**，
   * 單靠它推不出生效日（計畫 §7.0）。
   */
  9: { key: 'salary-income-withholding-tax-table', name: '薪資所得扣繳稅額表', maintenance: 'sync' },
  /**
   * **唯一的人工維護例外**（計畫 §3.1.1）。沒有任何可用來源：法條只寫死施行第一年的 2%，
   * 現行值依法只存在於主管機關的逐年公告裡；data.gov.tw 全量目錄沒有；
   * 健保署網頁有值但沒有生效日（爬得到值、爬不到日期，不符合 §7.2）。
   *
   * 內容是費率、計費下限、單次上限三項，三者放同一個資料集而不是拆開——
   * 它們是同一次公告裡的同一件事，分開維護必然漂移。
   * 預設值由 migration `0015` 帶入；日後調整一律**新增版本**，不覆寫既有的值。
   */
  10: {
    key: 'health-insurance-supplementary-premium',
    name: '健保補充保險費（費率與計費門檻）',
    maintenance: 'manual',
  },
} as const satisfies Record<number, { key: string; name: string; maintenance: RegulatoryDatasetMaintenance }>

/**
 * `dataset_code` 在程式端的型別：上面那些數字的聯集（`1 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10`）。
 *
 * **這是「未知的 `datasetCode`」由 schema 驗證擋下、而不是變成業務錯誤的前提**（計畫 §4.4）：
 * 它是列舉值，不合法就是 `100`（§2 的輸入驗證），不是 `regulatory.datasets.errors.*` 裡的一則。
 *
 * `7` 在型別上就不存在——寫 `7` 會編譯不過，而不是在執行期查不到資料。
 */
export type RegulatoryDatasetCode = keyof typeof REGULATORY_DATASETS

/** 單一資料集的定義形狀（`REGULATORY_DATASETS` 的值）。 */
export type RegulatoryDataset = (typeof REGULATORY_DATASETS)[RegulatoryDatasetCode]

/**
 * 全部合法的 `dataset_code`，供輸入驗證的列舉與掃描器的下限自我檢查使用（通用規範 §7.2）。
 *
 * 由 {@link REGULATORY_DATASETS} 推導而不是另外列一份：另外列的那一份哪天少一個不會有地方變紅，
 * 而症狀是某個資料集的端點回 `100 參數錯誤`——看起來像前端傳錯，實際上是清單漏了。
 */
export const REGULATORY_DATASET_CODES = Object.keys(REGULATORY_DATASETS).map(Number) as RegulatoryDatasetCode[]
