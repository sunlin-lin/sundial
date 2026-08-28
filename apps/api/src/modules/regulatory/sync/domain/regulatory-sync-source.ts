/**
 * 哪些資料集有解析器，各自從哪裡抓（零 IO 純函式與常數，§0.1）。
 *
 * ## 「這個資料集能不能自動同步」是型別問題，不是執行期問題
 *
 * {@link SYNCABLE_DATASET_CODES} 是這件事的唯一來源，{@link SyncableDatasetCode} 由它推導。
 * 於是 `runSync(context, { datasetCode: 8 })` **編譯不過**——不需要一個「這個資料集還沒有解析器」
 * 的業務錯誤碼，也不需要在執行期回一句話。
 *
 * 這與 `datasets/domain/regulatory-dataset-code.ts` 那個 `maintenance` 欄位是**同一件事的兩面**：
 * 那裡記的是「這個資料集打算怎麼維護」（給人看的意圖），這裡是「現在真的有沒有那支程式」
 * （編譯期的事實）。兩者刻意不合併：意圖先於實作存在，`1`–`9` 全部標著 `sync`，
 * 但目前只有其中六項真的做出來了。
 *
 * ## 清單與來源設定**互相釘死**，兩個方向都是編譯錯誤
 *
 * 清單（{@link SYNCABLE_DATASET_CODES}）在前、來源設定（{@link REGULATORY_SYNC_SOURCES}）
 * `satisfies Record<SyncableDatasetCode, …>` 在後：
 *
 * - 加了解析器卻沒列進清單 → 來源設定多出一個 key → **excess property，編譯不過**；
 * - 列進清單卻沒有解析器 → 來源設定少一個 key → **missing property，編譯不過**。
 *
 * 這是把「排程要掃哪些資料集」那份清單收掉之後仍然保有的那道保護
 * （原本在 `scheduler/regulatory-sync-scheduler.ts` 裡有第二份 `satisfies Record<…, true>`）。
 * 排程器現在直接用這裡的清單，於是那份會漂移的副本消失了，而「漏列會編譯不過」還在。
 *
 * ## 目前有 `1`–`6`，分成兩種形態
 *
 * | 代碼 | 資料集 | 形態 | 生效日在哪 |
 * |---|---|---|---|
 * | `1` | 勞工保險投保薪資分級表 | 單資源 JSON | 資料欄位 `適用起日` |
 * | `2` | 全民健康保險投保金額分級表 | **多資源 CSV（16 個年度版本）** | **各自的資源說明**（`115年1月…`） |
 * | `3` | 勞工退休金月提繳工資分級表 | 單資源 JSON | 資料欄位 `生效日` |
 * | `4` | 勞就保保險費分擔金額表 | 單資源 JSON | 資源說明（內容沒有日期欄位） |
 * | `5` | 健保費負擔金額表（有一定雇主之受僱者） | **多資源 CSV（19 個年度版本）** | **各自的資源說明** |
 * | `6` | 職業災害保險行業別費率 | 單資源 JSON | 資源說明（同上） |
 *
 * 兩種形態的差別與它為什麼不能合成一條路，見 `regulatory-sync-model.ts` 的 `RegulatorySyncSource`。
 *
 * 其餘兩項（`8`、`9`）的解析器與形狀要一起定（計畫 §6：形狀是跟著解析器被確定的），
 * 而 `datasets/domain/regulatory-record-shape.ts` 裡它們仍是 `Type.Never()`
 * ——就算有人在這裡偷偷加一項，寫入前的形狀驗證也會擋下來。兩道門是刻意的。
 */
import { RegulatoryRawFormat } from '../../../../db/schema/index.ts'
import type { RegulatoryDatasetCode } from '../../datasets/regulatory-datasets.service.ts'
import { parseHealthInsurancePremiumShares } from './regulatory-health-insurance-premium-share.ts'
import { parseHealthInsuranceSalaryGrades } from './regulatory-health-insurance-salary-grade.ts'
import { parseLaborEmploymentInsurancePremiumShares } from './regulatory-labor-employment-insurance-premium.ts'
import { parseLaborInsuranceSalaryGrades } from './regulatory-labor-insurance-salary.ts'
import { parseLaborPensionContributionWageGrades } from './regulatory-labor-pension-contribution-wage.ts'
import { parseOccupationalAccidentInsuranceRates } from './regulatory-occupational-accident-insurance-rate.ts'
import { parseRocYearMonthFromText } from './regulatory-roc-date.ts'
import type { RegulatoryEffectiveFromResult, RegulatorySyncSource } from './regulatory-sync-model.ts'

/**
 * 目前真的同步得了的資料集代碼，**這是那份清單唯一的一份**。
 *
 * `satisfies readonly RegulatoryDatasetCode[]` 擋掉不存在的代碼（例如永久空號 `7`）：
 * 寫錯是編譯錯誤，不是同步時查不到資料集。與 {@link REGULATORY_SYNC_SOURCES} 的互釘見檔頭。
 *
 * 順序即排程掃描的順序（`scheduler/` 直接用這個陣列）：由小到大，沒有別的意義
 * ——資料集之間沒有相依，誰先誰後不影響結果，而數字順序是唯一不需要解釋的順序。
 */
export const SYNCABLE_DATASET_CODES = [1, 2, 3, 4, 5, 6] as const satisfies readonly RegulatoryDatasetCode[]

/** 目前真的同步得了的資料集代碼。`runSync` 只收這個聯集。 */
export type SyncableDatasetCode = (typeof SYNCABLE_DATASET_CODES)[number]

/**
 * `dataset_code=2`、`5` 的生效日推導：從**資源說明**讀「N年M月」（計畫 §7.2 的落點）。
 *
 * 兩個資料集共用同一支，因為它們的資源說明出自同一個機關、同一種措辭
 * （`115年1月全民健康保險投保金額分級表`／`115年1月有一定雇主受僱者健保費負擔金額表`）。
 * 各寫一份的話，其中一份哪天為了讓某個新寫法通過而放寬，另一份不會跟著鬆。
 *
 * **政府沒給說明時 `null`**，而 `null` 走的是「找不到年月」那條失敗分支——不是拋錯，
 * 也不是回一個預設日期。訊息會講明是哪一種（沒寫、只有年份、還是讀不懂），見 `regulatory-roc-date.ts`。
 */
const deriveNhiEffectiveFrom = (resourceDescription: string | null): RegulatoryEffectiveFromResult =>
  resourceDescription === null
    ? {
        ok: false,
        reason: 'metadata 沒有給資源說明，而本資料集的生效日只寫在資源說明裡（資源內容沒有任何日期欄位）',
      }
    : parseRocYearMonthFromText(resourceDescription, '資源說明')

/**
 * 有解析器的資料集 → 它的來源設定。
 *
 * `satisfies Record<SyncableDatasetCode, …>` 是**總的**：與 {@link SYNCABLE_DATASET_CODES}
 * 互相釘死，兩個方向都是編譯錯誤（見檔頭）。
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
    kind: 'single-version',
    datasetId: 6258,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseLaborInsuranceSalaryGrades,
  },

  /**
   * 全民健康保險投保金額分級表。
   *
   * **這是第一個「一次同步 → N 個版本」的資料集**：`20251` 的 `distribution[]` 有 **16 筆 CSV**，
   * 每一筆是一個年度版本，生效日各自寫在自己的資源說明裡（`115年1月全民健康保險投保金額分級表`）。
   * 一次同步會把所有還沒有的版本補進來，於是歷史一次回補。
   *
   * 取 CSV 不是選擇：健保署把資源託管在自己那裡（`info.nhi.gov.tw/api/iode0000s01/Dataset?rId=…`），
   * 實測 16 個資源**全部只有 CSV** 一種格式，沒有 JSON 可選（與勞動部那四個相反）。
   *
   * ⚠️ **其中 9 筆的說明只有年份、沒有月份**（`100年…`～`109年…`），那 9 個版本依計畫 §7.2
   * 一律失敗、不得猜，因此這個資料集實際回補得到的最早版本是**民國 110 年 1 月**，
   * 而穩定狀態下這個資料集的同步結果是 `status=3`（有 9 個版本進不來）。
   * 完整的理由與「要讓它變綠有哪兩條路」寫在 `regulatory-multi-version-plan.ts` 的檔頭。
   */
  2: {
    kind: 'multi-version',
    datasetId: 20251,
    resourceFormat: 'CSV',
    rawFormatCode: RegulatoryRawFormat.Csv,
    deriveEffectiveFrom: deriveNhiEffectiveFrom,
    parse: parseHealthInsuranceSalaryGrades,
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
    kind: 'single-version',
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
    kind: 'single-version',
    datasetId: 6259,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseLaborEmploymentInsurancePremiumShares,
  },

  /**
   * 健保費負擔金額表（有一定雇主之受僱者）。
   *
   * 形態與 `2` 相同（多資源 CSV），但**19 筆的說明全部都有年月**（實測），
   * 因此一次同步就能把民國 100 年 1 月以來的每一版補齊——計畫 §7.0 特別點名的那個好處，
   * 在這個資料集上是完整成立的。
   *
   * 與 `2` 共用同一支 {@link deriveNhiEffectiveFrom}：同一個機關、同一種措辭。
   */
  5: {
    kind: 'multi-version',
    datasetId: 20246,
    resourceFormat: 'CSV',
    rawFormatCode: RegulatoryRawFormat.Csv,
    deriveEffectiveFrom: deriveNhiEffectiveFrom,
    parse: parseHealthInsurancePremiumShares,
  },

  /**
   * 勞工職業災害保險行業別費率。
   *
   * 生效日同樣在資源說明裡。這一份每三年才調整一次，因此絕大多數同步會停在 checksum 比對
   * （`status=4 無異動`）——生效日那條路要等到三年後政府換資料時才會被真正檢驗。
   */
  6: {
    kind: 'single-version',
    datasetId: 6262,
    resourceFormat: 'JSON',
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseOccupationalAccidentInsuranceRates,
  },
} as const satisfies Record<SyncableDatasetCode, RegulatorySyncSource>

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
