/**
 * 哪些資料集有解析器，各自從哪裡抓（零 IO 純函式與常數，§0.1）。
 *
 * ## 「這個資料集能不能自動同步」是型別問題，不是執行期問題
 *
 * {@link SYNCABLE_DATASET_CODES} 是這件事的唯一來源，{@link SyncableDatasetCode} 由它推導。
 * 於是 `runSync(context, { datasetCode: 10 })` **編譯不過**——不需要一個「這個資料集不能自動同步」
 * 的業務錯誤碼，也不需要在執行期回一句話。
 *
 * 這與 `datasets/domain/regulatory-dataset-code.ts` 那個 `maintenance` 欄位是**同一件事的兩面**：
 * 那裡記的是「這個資料集打算怎麼維護」（給人看的意圖），這裡是「現在真的有沒有那支程式」
 * （編譯期的事實）。兩者刻意不合併：意圖先於實作存在，而它們現在剛好對得起來
 * ——`1`–`9` 標著 `sync` 且八支解析器都在了，`10` 標著 `manual` 且不在這份清單裡。
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
 * ## 八個資料集，兩種形態
 *
 * | 代碼 | 資料集 | 形態 | 生效日在哪 |
 * |---|---|---|---|
 * | `1` | 勞工保險投保薪資分級表 | 單資源 JSON | 資料欄位 `適用起日` |
 * | `2` | 全民健康保險投保金額分級表 | **多資源 CSV（16 個資源）** | **各自的資源說明**（`115年1月…`） |
 * | `3` | 勞工退休金月提繳工資分級表 | 單資源 JSON | 資料欄位 `生效日` |
 * | `4` | 勞就保保險費分擔金額表 | 單資源 JSON | 資源說明（內容沒有日期欄位） |
 * | `5` | 健保費負擔金額表（有一定雇主之受僱者） | **多資源 CSV（19 個年度版本）** | **各自的資源說明** |
 * | `6` | 職業災害保險行業別費率 | 單資源 JSON | 資源說明（同上） |
 * | `8` | 最低工資（月薪與時薪） | **多資源 HTML（公告頁上的每一則公告）** | 公告內文「自115年1月1日起實施」 |
 * | `9` | 薪資所得扣繳稅額表 | **多資源 CSV（下載專區的每一個年度）** | 連結的檔名「…_115年度.csv」 |
 *
 * 兩種形態的差別與它為什麼不能合成一條路，見 `regulatory-sync-model.ts` 的 `RegulatorySyncSource`。
 *
 * ## `8`、`9` 不經過 data.gov.tw，而那不是偷懶
 *
 * 前六個的資源探索都是 data.gov.tw 的 metadata API。那兩個沒有那條路可走（計畫 §7.0）：
 * `6281`（基本工資）的內容停在民國 113 年卻仍顯示今年的 `modifiedDate`——同步會成功、
 * 拿到舊值、不報錯；`25627`（扣繳稅額表）只有當年度一份，而且四處都沒有年度標示。
 * 兩支解析器的檔頭各自寫著完整的取捨（`regulatory-minimum-wage.ts`、`regulatory-withholding-tax.ts`）。
 *
 * 因此多資源那條路的「怎麼探索」是一個**函式**（{@link RegulatoryMultiVersionSource.listResources}），
 * 而它後面的每一步（幂等、候選判準、逐版本交易、狀態碼對應）三個來源完全共用。
 */
import { RegulatoryRawFormat } from '../../../../db/schema/index.ts'
import type { RegulatoryDatasetCode } from '../../datasets/regulatory-datasets.service.ts'
import { listDataGovResources, selectDataGovResource, toDataGovMetadataUrl } from './regulatory-data-gov.ts'
import { parseHealthInsurancePremiumShares } from './regulatory-health-insurance-premium-share.ts'
import { parseHealthInsuranceSalaryGrades } from './regulatory-health-insurance-salary-grade.ts'
import { parseLaborEmploymentInsurancePremiumShares } from './regulatory-labor-employment-insurance-premium.ts'
import { parseLaborInsuranceSalaryGrades } from './regulatory-labor-insurance-salary.ts'
import { parseLaborPensionContributionWageGrades } from './regulatory-labor-pension-contribution-wage.ts'
import {
  deriveMinimumWageEffectiveFrom,
  listMinimumWageAnnouncements,
  MINIMUM_WAGE_PAGE_URL,
  parseMinimumWage,
} from './regulatory-minimum-wage.ts'
import { parseOccupationalAccidentInsuranceRates } from './regulatory-occupational-accident-insurance-rate.ts'
import { isRocYearWithoutMonth, parseRocYearMonthFromText } from './regulatory-roc-date.ts'
import type {
  RegulatoryEffectiveFromResult,
  RegulatoryMultiVersionSource,
  RegulatorySingleVersionSource,
  RegulatorySyncSource,
} from './regulatory-sync-model.ts'
import {
  deriveWithholdingTaxEffectiveFrom,
  listWithholdingTaxResources,
  parseWithholdingTaxTable,
  WITHHOLDING_TAX_PAGE_URL,
} from './regulatory-withholding-tax.ts'

/**
 * 目前真的同步得了的資料集代碼，**這是那份清單唯一的一份**。
 *
 * `satisfies readonly RegulatoryDatasetCode[]` 擋掉不存在的代碼（例如永久空號 `7`）：
 * 寫錯是編譯錯誤，不是同步時查不到資料集。與 {@link REGULATORY_SYNC_SOURCES} 的互釘見檔頭。
 *
 * 順序即排程掃描的順序（`scheduler/` 直接用這個陣列）：由小到大，沒有別的意義
 * ——資料集之間沒有相依，誰先誰後不影響結果，而數字順序是唯一不需要解釋的順序。
 *
 * `10` 不在這裡也不會在這裡：它是唯一的人工維護例外，沒有任何來源（計畫 §3.1.1）。
 */
export const SYNCABLE_DATASET_CODES = [1, 2, 3, 4, 5, 6, 8, 9] as const satisfies readonly RegulatoryDatasetCode[]

/** 目前真的同步得了的資料集代碼。`runSync` 只收這個聯集。 */
export type SyncableDatasetCode = (typeof SYNCABLE_DATASET_CODES)[number]

/**
 * `dataset_code=2`、`5` 的生效日推導**與候選判準**（計畫 §7.2 ＋ §7.1.2 的落點）。
 *
 * 兩個資料集共用同一支，因為它們的資源說明出自同一個機關、同一種措辭
 * （`115年1月全民健康保險投保金額分級表`／`115年1月有一定雇主受僱者健保費負擔金額表`）。
 * 各寫一份的話，其中一份哪天為了讓某個新寫法通過而放寬，另一份不會跟著鬆。
 *
 * ## 三種結局，而中間那一種是這一支存在的理由
 *
 * | 資源說明 | 結局 |
 * |---|---|
 * | 沒有說明（`null`） | **失敗**：本資料集的生效日只寫在說明裡，沒有說明就是推導不出來 |
 * | 只有年份、沒有月份（`100年全民健康保險投保金額分級表`） | **不是候選**，排除並計數 |
 * | `115年1月…` | 生效日＝該月 1 日 |
 *
 * 中間那一種：`20251` 的 16 個資源裡有 **9 個**是這樣（`100年…`～`109年…`，實測）。
 * 照 §7.2 的字面處理它們每晚都失敗，於是 `dataset_code=2` 在**穩定狀態下永遠是 `status=3`**
 * ——而一個永遠紅的告警三個月後就沒有人會看，那時真正的失敗（政府改了格式）跟著被忽略。
 * 因此它們是**排除**（我們決定不同步）而不是失敗（我們不知道它是哪一天）。
 *
 * **判準是機械的**（§7.6）：多資源的候選，資源名稱必須推導得出**年 ＋ 月**；只有年份的不是候選。
 * 判定用的是 `isRocYearWithoutMonth`，而它與 `parseRocYearMonthFromText` **共用同兩個 pattern**
 * ——兩份的話會出現「推導得出生效日、卻不是候選」這種沒有人想得出來的狀態。
 *
 * ⚠️ **排除不得靜默**：被排除的數量會經過 `planMultiVersionSync` 進到同步摘要
 * （見 `impl/regulatory-sync.run.service.ts`）。少了那一行，「政府哪天把新資源也只標年份」
 * 會變成看不見的資料缺口。
 *
 * ## 代價寫明
 *
 * `2` 只回補到民國 110 年 1 月，民國 100–109 年的分級表系統裡沒有；那些期間不會在這套系統裡結算薪資
 * （計畫 §7.1.2 的原文）。`5` 的 19 個資源全部都有年月，因此一個都不會被排除。
 */
const deriveNhiEffectiveFrom = (resourceDescription: string | null): RegulatoryEffectiveFromResult => {
  if (resourceDescription === null) {
    return {
      ok: false,
      // **不是**排除：政府本來有給說明，這一次沒給，那是我們讀不出來，不是我們決定不要它。
      excluded: false,
      reason: 'metadata 沒有給資源說明，而本資料集的生效日只寫在資源說明裡（資源內容沒有任何日期欄位）',
    }
  }

  const parsed = parseRocYearMonthFromText(resourceDescription, '資源說明')
  if (parsed.ok) return { ok: true, effectiveFrom: parsed.value, effectiveTo: null }

  return {
    ok: false,
    excluded: isRocYearWithoutMonth(resourceDescription),
    reason: parsed.reason,
  }
}

/**
 * data.gov.tw 的**單資源**探索設定（`1`、`3`、`4`、`6`）。
 *
 * 抽成一支的理由與 `regulatory-amount.ts` 抽共用函式相同：四個資料集的探索方式**完全一樣**，
 * 抄四份的代價不是行數而是分岔。`datasetId` 是穩定的數字，是這四個資料集唯一寫死的政府識別碼
 * （計畫 §7.0）；資源網址每次同步重新探索。
 */
const dataGovSingleResource = (
  datasetId: number,
  resourceFormat: string,
): Pick<RegulatorySingleVersionSource, 'discoveryUrl' | 'selectResource'> => ({
  discoveryUrl: toDataGovMetadataUrl(datasetId),
  selectResource: (body) => selectDataGovResource(body, resourceFormat),
})

/** data.gov.tw 的**多資源**探索設定（`2`、`5`）：同一個資料集底下每一筆該格式的資源都是一個版本。 */
const dataGovAllResources = (
  datasetId: number,
  resourceFormat: string,
): Pick<RegulatoryMultiVersionSource, 'discoveryUrl' | 'listResources'> => ({
  discoveryUrl: toDataGovMetadataUrl(datasetId),
  listResources: (body) => listDataGovResources(body, resourceFormat),
})

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
    ...dataGovSingleResource(6258, 'JSON'),
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
   * ⚠️ **其中 9 筆的說明只有年份、沒有月份**（`100年…`～`109年…`）。它們**不是候選**
   * （計畫 §7.1.2），因此是排除、不是失敗——這個資料集在穩定狀態下是 `status=4 無異動`，
   * 不是每晚一則 error。排除的數量會寫進同步摘要，判準與完整理由見 {@link deriveNhiEffectiveFrom}。
   *
   * 代價：實際回補得到的最早版本是**民國 110 年 1 月**，民國 100–109 年的分級表系統裡沒有。
   */
  2: {
    kind: 'multi-version',
    ...dataGovAllResources(20251, 'CSV'),
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
    ...dataGovSingleResource(6274, 'JSON'),
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
    ...dataGovSingleResource(6259, 'JSON'),
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
    ...dataGovAllResources(20246, 'CSV'),
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
    ...dataGovSingleResource(6262, 'JSON'),
    rawFormatCode: RegulatoryRawFormat.Json,
    parse: parseOccupationalAccidentInsuranceRates,
  },

  /*
   * `7` 是永久空號（見 `datasets/domain/regulatory-dataset-code.ts`），因此這裡也沒有它。
   */

  /**
   * 最低工資（月薪與時薪）。
   *
   * **第一個不經過 data.gov.tw 的資料集**：來源是勞動部「歷年最低工資/基本工資調整」公告頁，
   * 一頁 HTML，每一則條列是一則公告、也就是一個版本。
   * 三條路（data.gov.tw `6281`／行政院公報 XML／這一頁）的取捨，以及為什麼**不爬**
   * 「基本工資之制訂與調整經過」那一頁，完整寫在 `regulatory-minimum-wage.ts` 的檔頭。
   *
   * `rawFormatCode` 是 HTML：`raw_data` 存的是整頁原始碼（那一則公告不是一個獨立的可下載檔案）。
   *
   * ⚠️ **涵蓋範圍是民國 114 年 1 月起**（《最低工資法》施行之後那兩則公告）。
   * 113 年以前的基本工資不在這個資料集裡，理由不是難解析，是那一頁有「只調月薪」與「只調時薪」的
   * 單值公告，而本資料集的一個版本必須同時有兩筆——詳見解析器檔頭。
   */
  8: {
    kind: 'multi-version',
    discoveryUrl: MINIMUM_WAGE_PAGE_URL,
    listResources: listMinimumWageAnnouncements,
    rawFormatCode: RegulatoryRawFormat.Html,
    deriveEffectiveFrom: deriveMinimumWageEffectiveFrom,
    parse: parseMinimumWage,
  },

  /**
   * 薪資所得扣繳稅額表。
   *
   * 來源是財政部臺北國稅局「Open Data 下載專區」列表頁，**不是** data.gov.tw `25627`
   * （後者只有當年度一份，而且四處都沒有年度標示，推不出生效日）。
   * 列表頁上每個年度各一份 CSV，因此**歷史一次回補**：民國 107、109、111–115 共七個年度。
   *
   * ⚠️ 民國 108 年度那一份的檔名沒有年度（不是候選，排除並計數），110 年度列表頁本來就沒有。
   * 兩年的空缺由 `effective_to` 擋住——這是唯一一個版本帶失效日的資料集，
   * 因為「115年度」四個字本身就是政府明示的適用範圍（計畫 §3.2 (d)）。
   * 完整理由見 `regulatory-withholding-tax.ts` 的檔頭。
   */
  9: {
    kind: 'multi-version',
    discoveryUrl: WITHHOLDING_TAX_PAGE_URL,
    listResources: listWithholdingTaxResources,
    rawFormatCode: RegulatoryRawFormat.Csv,
    deriveEffectiveFrom: deriveWithholdingTaxEffectiveFrom,
    parse: parseWithholdingTaxTable,
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
