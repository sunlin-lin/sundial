/**
 * 哪些資料集有解析器，各自從哪裡抓（零 IO 純函式與常數，§0.1）。
 *
 * ## 「這個資料集能不能自動同步」是型別問題，不是執行期問題
 *
 * {@link REGULATORY_SYNC_SOURCES} 是 `Partial<Record<RegulatoryDatasetCode, …>>`，
 * 而 {@link SyncableDatasetCode} 由它的 key 推導。於是 `runSync(context, { datasetCode: 2 })`
 * **編譯不過**——不需要一個「這個資料集還沒有解析器」的業務錯誤碼，也不需要在執行期回一句話。
 *
 * 這與 `datasets/domain/regulatory-dataset-code.ts` 那個 `maintenance` 欄位是**同一件事的兩面**：
 * 那裡記的是「這個資料集打算怎麼維護」（給人看的意圖），這裡是「現在真的有沒有那支程式」
 * （編譯期的事實）。兩者刻意不合併：意圖先於實作存在，`1`–`9` 全部標著 `sync`，
 * 但目前只有其中四項真的做出來了。
 *
 * ## 目前有 `1`、`3`、`4`、`6`
 *
 * 四項的共同點是「單一當期資源、一次同步產生一個版本」（計畫 §7.1）。
 * 生效日的來源分兩種，這個差別決定了解析器要不要用 `RegulatoryParseContext`：
 *
 * | 代碼 | 資料集 | 生效日在哪 |
 * |---|---|---|
 * | `1` | 勞工保險投保薪資分級表 | 資料欄位 `適用起日` |
 * | `3` | 勞工退休金月提繳工資分級表 | 資料欄位 `生效日` |
 * | `4` | 勞就保保險費分擔金額表 | **資源說明**（資源內容沒有日期欄位） |
 * | `6` | 職業災害保險行業別費率 | **資源說明**（同上） |
 *
 * 其餘四項（`2`、`5`、`8`、`9`）的解析器與形狀要一起定（計畫 §6：形狀是跟著解析器被確定的），
 * 而 `datasets/domain/regulatory-record-shape.ts` 裡它們仍是 `Type.Never()`
 * ——就算有人在這裡偷偷加一項，寫入前的形狀驗證也會擋下來。兩道門是刻意的。
 */
import { RegulatoryRawFormat } from '../../../../db/schema/index.ts'
import type { RegulatoryDatasetCode } from '../../datasets/regulatory-datasets.service.ts'
import { parseLaborEmploymentInsurancePremiumShares } from './regulatory-labor-employment-insurance-premium.ts'
import { parseLaborInsuranceSalaryGrades } from './regulatory-labor-insurance-salary.ts'
import { parseLaborPensionContributionWageGrades } from './regulatory-labor-pension-contribution-wage.ts'
import { parseOccupationalAccidentInsuranceRates } from './regulatory-occupational-accident-insurance-rate.ts'
import type { RegulatorySyncSource } from './regulatory-sync-model.ts'

/**
 * 有解析器的資料集 → 它的來源設定。
 *
 * `satisfies` 把 key 釘在 {@link RegulatoryDatasetCode} 上：寫一個不存在的代碼（例如永久空號 `7`）
 * 當場編譯不過，而不是同步時查不到資料集。
 */
export const REGULATORY_SYNC_SOURCES = {
  /**
   * 勞工保險投保薪資分級表。
   *
   * `6258` 是 data.gov.tw 的資料集 id，**這是本模組唯一寫死的政府識別碼**（計畫 §7.0）；
   * 資源網址每次同步重新探索，理由見 `regulatory-data-gov.ts` 檔頭。
   *
   * 取 JSON 而不是 CSV：同一份資料兩種格式都有，而 JSON 的欄位名在內容裡（`"適用起日"`），
   * CSV 則要另外處理標頭列、編碼與引號跳脫——同樣一份資料，少一整類會靜靜出錯的地方。
   */
  1: {
    datasetId: 6258,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseLaborInsuranceSalaryGrades,
  },

  /**
   * 勞工退休金月提繳工資分級表。
   *
   * `6274` 是**當期**那一份（62 列，每一列都帶 `生效日`）。計畫 §7.0 另外記了一個歷年版 `13335`
   * （987 列、涵蓋民國 94 年起的 16 個生效日），**這裡刻意不用它**：本模組的同步流程是
   * 「一次同步產生一個版本」（§7.1），而歷年版一次帶著十幾個生效日，推導不出唯一的
   * `effective_from`。要回補歷史是另一件事（一次把十幾個版本建起來），不是這條路。
   */
  3: {
    datasetId: 6274,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseLaborPensionContributionWageGrades,
  },

  /**
   * 勞就保保險費分擔金額表。
   *
   * 生效日在 metadata 的資源說明裡（資源內容沒有任何日期欄位），因此它的解析器會用到
   * `RegulatoryParseContext.resourceDescription`——這也是那個參數存在的原因。
   *
   * 這個資料集另有 XML 格式，仍然取 JSON：理由與 `1` 相同（欄位名在內容裡，不必處理標頭與跳脫）。
   */
  4: {
    datasetId: 6259,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseLaborEmploymentInsurancePremiumShares,
  },

  /**
   * 勞工職業災害保險行業別費率。
   *
   * 生效日同樣在資源說明裡。這一份每三年才調整一次，因此絕大多數同步會停在 checksum 比對
   * （`status=4 無異動`）——生效日那條路要等到三年後政府換資料時才會被真正檢驗。
   */
  6: {
    datasetId: 6262,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseOccupationalAccidentInsuranceRates,
  },
} as const satisfies Partial<Record<RegulatoryDatasetCode, RegulatorySyncSource>>

/** 目前真的同步得了的資料集代碼。`runSync` 只收這個聯集。 */
export type SyncableDatasetCode = keyof typeof REGULATORY_SYNC_SOURCES

/**
 * 執行期的收斂，給「拿一個 `number` 決定要不要同步」的呼叫端用（例如日後的排程器逐一掃描）。
 *
 * 型別聯集在編譯期擋得住寫死的代碼，擋不住從設定檔或資料庫讀進來的數字——那條路一樣要有一道門。
 */
export const isSyncableDatasetCode = (value: number): value is SyncableDatasetCode =>
  Object.hasOwn(REGULATORY_SYNC_SOURCES, value)

/** 生效日 `YYYY-MM-DD` → 版本代碼 `YYYY-MM` 的擷取位置。 */
const YEAR_MONTH_LENGTH = 7

/**
 * 版本代碼：**西元的 `YYYY-MM`，由生效日推導**（形式與 migration `0015` 寫進去的 `2021-01` 一致）。
 *
 * 為什麼不由各資料集的解析器自己決定：同一個概念會長出九種寫法，而 `version_code` 是
 * `UNIQUE(dataset_code, version_code)` 的一半——寫法不一致時，同一份資料在不同版本代碼下
 * 會被當成兩個版本並存，直接餵給計畫 §3.2 的排序問題。
 *
 * 為什麼不把 checksum 或同步日期摻進去（例如 `2026-01-a3f9`）：那樣**永遠不會撞唯一鍵**，
 * 於是「政府改了內容但沒有改生效日」這件事會安靜地變成兩個同日生效的版本，
 * 而 `resolve` 挑到哪一版取決於寫入順序。撞鍵是我們**要的**訊號，見 run 切片對它的處置。
 */
export const toVersionCode = (effectiveFrom: string): string => effectiveFrom.slice(0, YEAR_MONTH_LENGTH)
