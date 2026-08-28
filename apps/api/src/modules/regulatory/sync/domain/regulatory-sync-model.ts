/**
 * 同步次目錄的跨層型別、執行相依與純判定（零 IO，§0.1、§1.4）。
 *
 * 位置的理由與 `datasets/domain/regulatory-dataset-model.ts` 相同：§0.2 的檔名白名單沒有
 * 「模組共用型別」這個位置，放進入口檔會讓 `impl/` 的切片回頭 import 入口檔（循環相依）。
 *
 * ## 這個次目錄與 `datasets` 的分工
 *
 * 讀的人是 Payroll（每次結算都會呼叫、不能失敗、不能慢），寫的人是排程（一天一次、可以失敗、
 * 失敗要留紀錄）。合在一起的話，Payroll 的查詢路徑會一路 import 到 HTTP fetch 與解析器（計畫 §4）。
 * 因此 `sync` 可以 import `datasets` 的 service 與 `domain/`（§0.3 允許同一大目錄內的次目錄互相
 * import），但**不得碰 `datasets` 的 repository**。
 *
 * ## 對外的 IO 一律以「函式型別」注入，這裡只宣告形狀
 *
 * {@link FetchResource} 與 {@link StartHeartbeatTimer} 都是型別，不是實作——本目錄零 IO。
 * 生產環境的值由組裝點提供（見 `regulatory-sync.service.ts` 檔頭的兩行範例），
 * 測試則傳替身。§7.3 禁止的是 mock 掉**被測邏輯本身**，網路與計時器不是本模組的業務規則。
 */
import type { Database } from '../../../../db/client.ts'
import type {
  RegulatoryRawFormatValue,
  RegulatorySyncStatusValue,
  RegulatorySyncTriggerTypeValue,
} from '../../../../db/schema/index.ts'
import type { RegulatoryDatasetCode } from '../../datasets/regulatory-datasets.service.ts'
// `isRegulatoryDatasetCode` 不在 `datasets` 的 service 出口上（那一支只暴露型別與排序輔助），
// 因此直接引用它的 `domain/`。§0.3 允許同一大目錄內的次目錄互相 import；**不得碰的是對方的
// repository**——要資料一律走 service，而這裡要的是一個零 IO 的判定函式。
import { isRegulatoryDatasetCode } from '../../datasets/domain/regulatory-dataset-model.ts'
import type { Clock } from '../../../../shared/clock.ts'
import type {
  RegulatorySourceResourceListResult,
  RegulatorySourceResourceResult,
} from './regulatory-source-resource.ts'

/**
 * 對政府端點的一次 GET。
 *
 * **簽章刻意與標準 `fetch` 相容**（`string` 是 `RequestInfo | URL` 的子型別，`{ signal }` 是
 * `RequestInit` 的子型別），於是生產環境的值就是 `fetch` 本身，**不需要任何轉接層**
 * ——轉接層要有一個實作檔，而那個檔案會是本模組唯一一段「因為分層規則而存在」的程式碼。
 *
 * `signal` 是**必填參數**而不是選填：逾時策略屬於本模組（政府端點回應緩慢是常態，計畫 §3.4
 * 就是拿它當「長步驟」的例子），寫成選填之後，忘記帶的那一次會是一個**永遠不會結束**的同步
 * ——心跳照樣跳，於是連逾時判定都救不了它。
 */
export type FetchResource = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>

/** 停止心跳計時器。呼叫多次必須是安全的（同步流程的 `finally` 與心跳自己都可能停它）。 */
export type StopHeartbeatTimer = () => void

/**
 * 一次心跳。
 *
 * **回傳 `Promise` 而不是 `void`**，即使生產環境的計時器不會去 await 它：
 * 心跳的內容是一次 UPDATE，而測試要斷言的正是「擊發一次計時器之後，`heartbeat_at` 真的往前走了」。
 * 簽章是 `() => void` 的話，測試只能睡一段時間再去查——那種測試在 CI 上會偶爾紅，
 * 於是最後被改成睡更久，最後被刪掉。
 */
export type HeartbeatTick = () => Promise<void>

/**
 * 啟動心跳計時器：每 `intervalMs` 毫秒呼叫一次 `tick`，回傳停止函式。
 *
 * **必須是獨立計時器，不得由工作步驟驅動**（計畫 §3.4）：Bun 是單一事件迴圈，
 * 「每完成一個步驟才更新一次 `heartbeat_at`」在遇到一個超過 180 秒的長步驟時（政府端點回應緩慢的
 * 單一 `await fetch()`），心跳就不會動——於是一個**活得好好的程序被判死**，第二個程序接手同時寫入。
 *
 * 之所以是注入的，就是為了讓這件事測得到：測試傳一個把 `tick` 收起來的替身，
 * 在「主流程還卡在 fetch」的時候手動擊發它，並斷言 `heartbeat_at` 真的往前走。
 */
export type StartHeartbeatTimer = (intervalMs: number, tick: HeartbeatTick) => StopHeartbeatTimer

/**
 * 同步的執行相依。
 *
 * **有 clock，這一點與 `datasets` 相反**：那一側刻意拿不到「現在」，因為它的時間維度只有呼叫端
 * 送來的 `asOfDate`（計畫 §4.2）。同步這一側每一個時間欄位（`started_at`、`heartbeat_at`、
 * `finished_at`、`synced_at`）都是「現在」，而 §6.2 要求「現在」由呼叫端注入。
 *
 * ⚠️ **clock 不得用來推導 `effective_from`**（計畫 §7.2）：推導不出生效日一律失敗，
 * 不得以同步當天日期 fallback。這條沒有型別擋得住（clock 本來就在手上），只有 review 與
 * 「解析器是純函式、拿不到 clock」這個結構在擋——{@link RegulatoryDatasetParser} 的簽章裡沒有時間。
 */
export type RegulatorySyncContext = {
  /** 資料庫連線。交易邊界在 service（§4.4），repository 不自開交易。 */
  readonly db: Database
  readonly clock: Clock
  readonly fetch: FetchResource
  readonly startHeartbeatTimer: StartHeartbeatTimer
}

/**
 * 查詢同步歷程的執行相依。
 *
 * **與 {@link RegulatorySyncContext} 分開，不是「少傳幾個就好」**：`/regulatory/sync/list` 是唯讀端點，
 * 給它 `fetch` 與計時器等於讓一支 HTTP 查詢有能力去打政府端點。分成兩個型別之後，
 * 那件事在路由組裝點就寫不出來。
 */
export type RegulatorySyncQueryContext = {
  readonly db: Database
}

/**
 * 心跳週期：60 秒（計畫 §3.4）。
 *
 * 與逾時門檻是**同一份來源推導**（下面 {@link HEARTBEAT_TIMEOUT_SECONDS}），不是兩個各寫一次的數字
 * ——兩個獨立常數會分岔，而分岔的方向若是「週期比門檻長」，每一個活著的程序都會被判死。
 */
export const HEARTBEAT_INTERVAL_SECONDS = 60

/** 心跳週期（毫秒），計時器用。 */
export const HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000

/**
 * 判定程序已死的門檻：**三個心跳週期**（計畫 §3.4）。
 *
 * 為什麼是三個而不是一個：漏掉一次心跳可能只是 GC 或 IO 卡住；連續三次沒更新，
 * 程序基本上不可能還活著。
 */
export const HEARTBEAT_TIMEOUT_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 3

/**
 * 這一筆執行中的紀錄算不算「程序已死」。
 *
 * @param heartbeatAt 該列的 `heartbeat_at`，台北牆鐘 `YYYY-MM-DD HH:mm:ss`。
 * @param staleBefore 門檻時刻（現在減三個心跳週期），同一格式。
 *
 * 直接比字串大小是正確的，不是取巧：`YYYY-MM-DD HH:mm:ss` 是**固定寬度、由大到小**的格式，
 * 字典序與時間序一致。轉成 `Date` 反而要引入時區（§6：全程台北牆鐘，不做任何換算）。
 */
export const isHeartbeatStale = (heartbeatAt: string, staleBefore: string): boolean => heartbeatAt < staleBefore

/**
 * 同步逾時：一次政府端點請求最多等多久。
 *
 * 90 秒遠大於實測值（勞動部那一支通常一秒內回完），這裡不是在調效能，而是在確保
 * 「**一定會結束**」：沒有逾時的 `fetch` 在對方半開連線時會永遠掛著，而心跳照樣跳
 * ——那筆紀錄會永遠停在執行中，且連逾時判定都救不了它（那是本模組唯一救不回來的狀態）。
 */
export const RESOURCE_FETCH_TIMEOUT_MS = 90_000

/**
 * 解析器產出的一筆 record。
 *
 * 欄位與 `regulatory_records` 一對一（除了 `dataset_version_id` 與 `created_at`，那兩個是寫入時才知道的）。
 * 四個數值欄位一律 **decimal 字串或 `null`**，禁止 `number`（§4.7、計畫 §6.1）。
 */
export type ParsedRegulatoryRecord = {
  /** 同一版本內穩定且唯一的資料鍵。**不得用「第幾列」**：列序政府隨時會改，改了不會有任何錯誤。 */
  readonly recordKey: string
  readonly code: string | null
  readonly name: string | null
  readonly rangeFrom: string | null
  readonly rangeTo: string | null
  readonly amount: string | null
  readonly rate: string | null
  /** 依 `dataset_code` 的形狀定義（計畫 §6）。寫入前會再驗一次，見 `impl/` 的 run 切片。 */
  readonly data: unknown
  /** 政府資料的原始列序。 */
  readonly sortOrder: number | null
}

/**
 * 解析結果。
 *
 * **失敗分支只有一個 `reason` 字串，沒有部分成功。** 「解析出 90 筆、有 7 筆看不懂」這種結果
 * 不存在——那 7 筆若是新的級距，少了它們的分級表在 Payroll 眼中是一張完整而錯誤的表。
 * 一律整批失敗（`status=3`），讓人去看 `error_message`。
 */
export type RegulatoryParseResult =
  | {
      readonly ok: true
      /**
       * 版本生效日 `YYYY-MM-DD`。**只能從來源明確推導**（計畫 §7.2）：
       * 不得以同步當天、上一版生效日或任何推測值 fallback。推導不出來時走失敗分支。
       */
      readonly effectiveFrom: string
      readonly records: readonly ParsedRegulatoryRecord[]
    }
  | { readonly ok: false; readonly reason: string }

/**
 * 只解析內容、不負責生效日的解析結果（多版本資料集用，見 {@link RegulatoryVersionRecordsParser}）。
 *
 * 失敗分支同樣只有一個 `reason`、同樣沒有部分成功，理由與 {@link RegulatoryParseResult} 逐字相同。
 */
export type RegulatoryRecordsResult =
  | { readonly ok: true; readonly records: readonly ParsedRegulatoryRecord[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 解析器除了資源內容之外，還看得到什麼。
 *
 * ## 為什麼需要它：`4` 與 `6` 的生效日不在資源內容裡
 *
 * `dataset_code=1`、`3` 的每一列都帶著生效日（`適用起日`／`生效日`），但 `4`（勞就保分擔金額表）
 * 與 `6`（職災費率表）的資源內容**一個日期欄位都沒有**（2026-08 實測，JSON／CSV／XML 三種格式皆然），
 * 生效日只寫在 metadata 的 `resourceDescription` 裡——計畫 §3.1 的表格記的就是「資源說明」。
 * 只餵 `rawText` 的話，那兩個資料集依 §7.2 只能一律失敗，也就是做不出來。
 *
 * ## 這裡**刻意只有資源說明一欄**
 *
 * 不放 `sourceModifiedAt`、不放同步時間、不放上一版的生效日。少的那幾樣正是 §7.2 點名的
 * fallback 材料：`modifiedDate` 看起來很像一個「合理的生效日」（它甚至常常就在生效日附近），
 * 而用它推出來的版本邊界會**完全合理地**錯掉。型別裡沒有那一欄，那行程式碼就寫不出來。
 */
export type RegulatoryParseContext = {
  /**
   * 本次 resource discovery 探索到的資源說明（`勞工職業災害保險適用行業別及費率表(114年1月1日起適用)`）。
   *
   * **政府沒給時是 `null`，而不是空字串**：需要它的解析器要能分辨「政府這次沒寫」與「寫了但讀不懂」，
   * 兩者的處置都是失敗，但 `error_message` 要指得出是哪一種（前者重跑沒用，後者要有人去看措辭）。
   */
  readonly resourceDescription: string | null
}

/**
 * 一個資料集的解析器。
 *
 * **簽章裡沒有時間、沒有資料庫、沒有網路**，這是計畫 §7.2 在型別上唯一的抓手：
 * 拿不到 clock，就寫不出「推導不出生效日就用今天」那個看起來很合理的 fallback。
 * {@link RegulatoryParseContext} 也是照這條規則挑欄位的，見它自己的說明。
 *
 * `context` 是**必填參數**而不是選填：寫成選填之後，忘記帶的那一次會讓 `4`、`6` 在執行期
 * 以「資源說明是 null」失敗，而那個症狀指向政府，不指向漏傳參數的那一行。必填則是編譯錯誤。
 */
export type RegulatoryDatasetParser = (rawText: string, context: RegulatoryParseContext) => RegulatoryParseResult

/**
 * 多版本資料集的解析器：**只解析內容，不回生效日**。
 *
 * 這是與 {@link RegulatoryDatasetParser} 唯一的差別，而它不是為了少寫一個欄位：
 * `dataset_code=2`、`5` 的生效日**只在 metadata 的資源說明裡**，而同步流程必須在**下載之前**
 * 就知道這一個資源對應哪一個 `version_code`（否則每天晚上都要把十幾份歷史資源重抓一次才知道
 * 它們早就進來了）。因此生效日的推導被抽成 {@link DeriveEffectiveFrom} 放在來源設定上，
 * 解析器就不再需要、也不再有資格回答那個問題——**同一個答案只有一個出處**。
 */
export type RegulatoryVersionRecordsParser = (
  rawText: string,
  context: RegulatoryParseContext,
) => RegulatoryRecordsResult

/**
 * 生效日推導的結果。
 *
 * ## 失敗分支有兩種，而它們是**兩件不同的事**（計畫 §7.1.2）
 *
 * | `excluded` | 語意 | 處置 |
 * |---|---|---|
 * | `false` | **推導不出生效日**：我們不知道它是哪一天 | 那個版本失敗（§7.2） |
 * | `true` | **不是候選**：我們決定不同步它 | 排除，不算失敗 |
 *
 * 這個欄位存在的理由是一個實際發生過的問題：`dataset_code=2` 的 16 個資源裡有 9 個是政府的
 * 年度標示（`100年…`～`109年…`）。照 §7.2 的字面處理，它們每晚都失敗，於是那個資料集在
 * **穩定狀態下永遠是 `status=3`、排程每晚一則 error**——而一個永遠紅的告警三個月後就沒有人會看，
 * 那時真正的失敗（政府改了格式）跟著被忽略。**告警疲勞比缺那幾版資料危險得多。**
 *
 * ⚠️ **但排除不得靜默**：被排除的數量必須出現在同步摘要裡（見
 * `impl/regulatory-sync.run.service.ts` 的多版本流程）。靜默跳過會讓「政府哪天把新資源也
 * 只標年份」變成看不見的資料缺口。
 *
 * **`excluded` 是必填欄位，不是選填**：做成選填之後，新來源的推導函式會在不做任何決定的情況下
 * 落到「失敗」那一邊——而那正是這個欄位要防的事。少寫它是編譯錯誤。
 *
 * ## 成功分支帶著 `effectiveTo`，而它幾乎總是 `null`
 *
 * `effective_to` **只在政府明示失效日時才寫入**（計畫 §3.2 (d)），不拿來記「下一版開始日的
 * 前一天」。目前只有 `dataset_code=9` 有值：扣繳稅額表的資源名稱寫著「115年度」，
 * 那四個字本身就宣告了它管到當年 12 月 31 日為止（理由見 `regulatory-roc-date.ts` 的
 * `parseRocFiscalYear`）。其餘資料集一律 `null`——而它是**必填**的，理由與 `excluded` 相同。
 */
export type RegulatoryEffectiveFromResult =
  | { readonly ok: true; readonly effectiveFrom: string; readonly effectiveTo: string | null }
  | { readonly ok: false; readonly excluded: boolean; readonly reason: string }

/**
 * 從**一個資源的說明**推導它的版本生效日 `YYYY-MM-DD`（多版本資料集專用）。
 *
 * **這是計畫 §7.2 在多版本流程上的落點**：推導不出來時回失敗分支，那個資源就不會產生版本，
 * 也不會被任何 fallback 補上一個日期。簽章裡只有資源說明——沒有 clock、沒有 `sourceModifiedAt`、
 * 沒有上一版的生效日，於是那幾個「看起來完全合理」的推測值一行都寫不出來
 * （理由與 {@link RegulatoryParseContext} 刻意只有一欄逐字相同）。
 *
 * **候選判準也在這一支裡**（計畫 §7.1.2）：它同時回答「這一份是不是候選」與「它是哪一天生效」，
 * 因為兩者的材料是同一個——資源自己的名字。分成兩支函式的話，其中一支哪天改了 pattern，
 * 會出現「推導得出生效日、卻不是候選」這種沒有人想得出來的狀態。
 */
export type DeriveEffectiveFrom = (resourceDescription: string | null) => RegulatoryEffectiveFromResult

/**
 * 同步來源設定的共同部分。
 *
 * **資源網址每次同步重新探索，一律不硬編**（計畫 §7.0）：實測勞動部的資源網址帶隨機尾碼
 * （`A17000000J-020014-Uy8`），硬編一定會壞，而壞掉的形式是 404——政府改版的那一天，
 * 同步從此失敗，沒有人知道原因在哪一行。硬編的只有**探索的入口**（{@link discoveryUrl}）。
 */
type RegulatorySyncSourceBase = {
  /**
   * 資源探索要打的網址。**這是每個資料集唯一寫死的政府位址。**
   *
   * 三種形態（計畫 §7.0）：data.gov.tw 的 metadata API（`1`–`6`，由 `datasetId` 組出來，
   * 而 `datasetId` 是一個穩定的數字）、財政部下載專區的列表頁（`9`）、勞動部的公告頁（`8`）。
   * 後兩者沒有 metadata API 可用，那一頁的網址就是我們能硬編的最穩定的東西。
   */
  readonly discoveryUrl: string
  /** 對應 `regulatory_dataset_versions.raw_format_code`：Snapshot 那串位元組原本是什麼格式。 */
  readonly rawFormatCode: RegulatoryRawFormatValue
}

/**
 * **一個資源 → 一個版本**的資料集（`1`、`3`、`4`、`6`）。
 *
 * 這一類的版本代碼**只有下載並解析之後才知道**：`1`、`3` 的生效日在資料列裡（`適用起日`／`生效日`），
 * `4`、`6` 雖然寫在資源說明上，但它們的資料集只有一個當期資源，沒有「該不該下載」這個問題。
 * 因此它們的流程維持原樣（下載 → checksum 比對最新版 → 相同即 `status=4 無異動`），
 * 一行都不必為了多版本而改。
 */
export type RegulatorySingleVersionSource = RegulatorySyncSourceBase & {
  /** 判別欄位。寫成字面值而不是「有沒有 `deriveEffectiveFrom`」，是為了讓兩條路在 `switch` 上是總的。 */
  readonly kind: 'single-version'
  /** 探索回應 → 這一次要下載的那一個資源。目前四個都是 `selectDataGovResource(body, 格式)`。 */
  readonly selectResource: (discoveryBody: string) => RegulatorySourceResourceResult
  readonly parse: RegulatoryDatasetParser
}

/**
 * **一個資源 → 一個版本，而同一個資料集底下有十幾個資源**的資料集（`2`、`5`、`8`、`9`）。
 *
 * `20251` 有 16 個 CSV 資源、`20246` 有 19 個（實測 2026-08），每一個是一個歷史版本，
 * 生效日各自寫在自己的資源說明裡。一次同步會把**所有還沒有的版本**補進來，
 * 於是歷史一次回補（`5` 回補到民國 100 年 1 月、`9` 回補到民國 107 年度）。
 *
 * 三個欄位分工：{@link listResources} 說「有哪些資源」、{@link deriveEffectiveFrom} 只看資源的名字
 * （因此可以在下載之前決定要不要下載），{@link parse} 只看內容。
 * 詳見 {@link RegulatoryVersionRecordsParser}。
 *
 * ## `listResources` 是一個函式，不是「格式字串」
 *
 * 原本這裡是 `datasetId` ＋ `resourceFormat`，因為四個多資源資料集全部來自 data.gov.tw。
 * `8`（勞動部公告頁）與 `9`（財政部下載專區）沒有那一層：前者的「資源」是頁面上的一則公告條列，
 * 後者是列表頁上的一個年度連結。做成函式之後，「怎麼把探索回應讀成一份資源清單」是各來源自己的事，
 * 而**它後面的每一步（幂等、候選判準、逐版本交易、狀態碼對應）三個來源完全共用**
 * ——那些才是這條路真正的規格。
 */
export type RegulatoryMultiVersionSource = RegulatorySyncSourceBase & {
  readonly kind: 'multi-version'
  /** 探索回應 → 這個資料集底下的**全部**資源（每一個是一個版本）。 */
  readonly listResources: (discoveryBody: string) => RegulatorySourceResourceListResult
  readonly deriveEffectiveFrom: DeriveEffectiveFrom
  readonly parse: RegulatoryVersionRecordsParser
}

/**
 * 一個資料集的同步來源設定。
 *
 * **刻意是兩種而不是「單資源是 N=1 的特例」**：兩條路在一件事上有本質差異——
 * 單資源的版本代碼要下載並解析之後才知道，多資源的則從 metadata 就知道。
 * 硬要合成一條的話，多資源那一邊每天晚上都得把十幾份歷史資源重新下載一次才能發現「它們早就進來了」
 *（一年七千多次請求換零個新版本），否則就要在單資源那條路上加一堆「這一次要不要下載」的分支
 * ——而那條路現在的讀法是一條直線。
 */
export type RegulatorySyncSource = RegulatorySingleVersionSource | RegulatoryMultiVersionSource

/** `runSync` 的輸入。 */
export type RunSyncInput<TCode extends RegulatoryDatasetCode = RegulatoryDatasetCode> = {
  readonly datasetCode: TCode
  /**
   * 這一次是排程還是人工觸發。
   *
   * **必填，沒有預設值**：兩者的處置不同（排程失敗要進告警，人工觸發失敗是操作者當場看得到的事，
   * 見 `db/schema/regulatory-sync-logs.ts`），而預設成「排程」會讓每一次手動執行都混進排程的統計裡。
   */
  readonly triggerTypeCode: RegulatorySyncTriggerTypeValue
}

/**
 * 一次同步的結果。
 *
 * `statusCode` 只會是 `2 成功` 或 `4 無異動`——`3 失敗` 走 `ServiceResult` 的失敗分支
 * （見 `regulatory-sync.errors.ts`），因此這個型別裡不會有「成功地失敗了」這種形狀。
 */
export type SyncOutcome = {
  /** 本次的 `regulatory_sync_logs.id`。失敗時也要拿得到它，因此它在錯誤的 `data` 裡也有一份。 */
  readonly syncLogId: number
  readonly datasetCode: RegulatoryDatasetCode
  readonly statusCode: RegulatorySyncStatusValue
  /** 本次寫入或辨識出的版本；`status=4` 時指向**既有的**那一版。 */
  readonly datasetVersionId: number | null
  readonly versionCode: string | null
  readonly effectiveFrom: string | null
  readonly recordCount: number | null
  /** 本次 resource discovery 抓到的資源網址。失敗追查時最有用的一欄。 */
  readonly governmentResourceId: string | null
}

/**
 * 同步歷程清單允許排序的欄位白名單（API 對外欄位名，camelCase）。
 *
 * 白名單是必要的（§1.4）：把 `sort.field` 直接接進 SQL 等於同時開放 SQL injection 與全表掃描。
 * 同一份常數餵給路由 schema 與 repository 的欄位對照，兩邊才不會出現「schema 允許但查詢不認得」。
 */
export const SYNC_LOG_SORT_FIELDS = ['startedAt', 'finishedAt', 'createdAt'] as const

export type SyncLogSortField = (typeof SYNC_LOG_SORT_FIELDS)[number]

export type SyncLogSortOption = {
  readonly field: SyncLogSortField
  readonly order: 'asc' | 'desc'
}

/**
 * 未指定排序時的預設：開始時間由新到舊。
 *
 * 這張表存在的問題是「最近幾次同步的結果如何」，而答案在最新的那一端；
 * 依 `createdAt` 排序在正常流程下等價，但補錄或修正歷程時兩者會分岔，而使用者問的是前者。
 */
export const DEFAULT_SYNC_LOG_SORT: SyncLogSortOption = { field: 'startedAt', order: 'desc' }

/**
 * 補上預設排序。
 *
 * 回傳值同時用於查詢與**回聲**（§1.4）：回聲的必須是「實際生效的排序」，
 * 否則前端拿回一個空的 `sort`，無從比對這包回應是不是自己現在畫面上這組條件的結果。
 */
export const resolveSyncLogSort = (sort: SyncLogSortOption | undefined): SyncLogSortOption =>
  sort ?? DEFAULT_SYNC_LOG_SORT

export type SyncLogListQuery = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly perPage: number
  readonly currentPage: number
  readonly sort: SyncLogSortOption
}

/**
 * 同步歷程的一筆。
 *
 * **有 `errorMessage`，而且它是這張表的重點**：資料字典要求「同步紀錄獨立保存每次下載、驗證與
 * 套用結果，讓失敗可追查」，把失敗原因藏起來等於這張表只剩下「有沒有跑過」。
 * 寫進這一欄的一律是我們自己組出來的訊息（哪一步、哪個值），**不是例外的 stack**（§3.2）。
 */
export type SyncLogSummary = {
  readonly id: number
  readonly datasetCode: RegulatoryDatasetCode
  readonly triggerTypeCode: RegulatorySyncTriggerTypeValue
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly statusCode: RegulatorySyncStatusValue
  readonly datasetVersionId: number | null
  readonly governmentResourceId: string | null
  readonly recordsReceived: number | null
  readonly errorMessage: string | null
  readonly heartbeatAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type SyncLogPage = {
  readonly items: readonly SyncLogSummary[]
  readonly totalCount: number
}

/**
 * 資料庫讀出來的同步歷程列：與 {@link SyncLogSummary} 只差在 `datasetCode` 還是普通 `number`。
 *
 * `regulatory_sync_logs.dataset_code` 在 schema 上**刻意沒有 `$type`**（合法值的唯一來源在
 * `modules/` 底下，而 `db/schema` 是它的下層），因此驅動回來的就是一個整數。
 */
export type SyncLogRow = Omit<SyncLogSummary, 'datasetCode'> & { readonly datasetCode: number }

/**
 * 收斂 `dataset_code`（形式與 `datasets/domain/` 的同名處置一致）。
 *
 * **對不上清單時拋例外**：這是系統錯誤而不是業務拒絕（§3.1.2）。資料庫裡出現一列指向不存在的
 * 資料集，代表有人手動寫入或某支 migration 寫錯，使用者沒有做錯任何事；
 * 回一筆業務錯誤會讓它看起來像一次普通的操作失敗，而它其實是資料損壞。
 */
export const toSyncLogSummary = (row: SyncLogRow): SyncLogSummary => {
  if (!isRegulatoryDatasetCode(row.datasetCode)) {
    throw new Error(
      `regulatory_sync_logs.id=${String(row.id)} 的 dataset_code=${String(row.datasetCode)} 不在資料集清單內（計畫 §3.1）`,
    )
  }

  return {
    id: row.id,
    datasetCode: row.datasetCode,
    triggerTypeCode: row.triggerTypeCode,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    statusCode: row.statusCode,
    datasetVersionId: row.datasetVersionId,
    governmentResourceId: row.governmentResourceId,
    recordsReceived: row.recordsReceived,
    errorMessage: row.errorMessage,
    heartbeatAt: row.heartbeatAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 執行中的同步：心跳逾時判定只需要這兩欄，多撈一欄都是多的。 */
export type RunningSyncLog = {
  readonly id: number
  readonly heartbeatAt: string
}

/**
 * 一個資料集**目前為止最近一次**同步的狀態，不分成功或失敗（`regulatory/datasets` 的
 * `overview` 動作用，實作計畫 03 §3、任務一）。
 *
 * 與 {@link SyncLogSummary} 的差別：這裡只留總覽一行摘要要顯示的四欄，不帶 `errorMessage`／
 * `recordsReceived`／`governmentResourceId` 這類細節——那些要看，前端本來就有
 * `/regulatory/sync/list` 可以打，總覽只需要「最近一次是什麼時候、結果如何」。
 */
export type DatasetLatestSyncStatus = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly statusCode: RegulatorySyncStatusValue
}
