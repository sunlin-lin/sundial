/**
 * 法規同步的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：
 * 業務拒絕一律以 `ServiceResult` 的失敗結果 ＋ 具名分組表達。這裡不是形式主義——
 * {@link runSync} 的呼叫者根本不經過 HTTP。
 *
 * ## 三個動作，只有一個有端點
 *
 * | 動作 | 呼叫者 |
 * |---|---|
 * | {@link listSyncLogs} | HTTP `/regulatory/sync/list` |
 * | {@link runSync} | 伺服器端的程序（排程或一次性執行），**沒有端點** |
 * | {@link listLatestSyncStatuses} | `regulatory/datasets` 次目錄的 `overview` 動作，**沒有端點** |
 *
 * §0.4 明文：「沒有端點的業務動作一樣放在入口檔」，因為它同樣是這個次實體對外的介面，
 * 只是呼叫者不是前端（或不是 HTTP）。`/regulatory/sync/trigger` 不開放的理由見計畫 D3；
 * `listLatestSyncStatuses` 的呼叫者是另一個次目錄，見 §0.3「同一大目錄內的次目錄可以
 * 互相呼叫對方的 service」。
 *
 * ## 誰來呼叫 `runSync`，是另一個決定
 *
 * 本輪**刻意不做排程器**：「多久跑一次、由誰跑」（作業系統的 cron、還是 API 程序內的計時器）
 * 是一個獨立的決定，而把它塞進本模組會讓「同步的業務規則」與「這台機器怎麼安排工作」綁在一起。
 *
 * 呼叫端要自備四樣相依（`RegulatorySyncContext`）。網路與計時器**刻意沒有預設值**——
 * 有預設值就等於本模組自己決定了逾時策略與計時器實作，而那正是測試要替換的兩樣東西：
 *
 * ```ts
 * await runSync(
 *   {
 *     db: database,
 *     clock: systemClock,
 *     // 標準 `fetch` 直接就符合 `FetchResource`，不需要任何轉接層。
 *     fetch,
 *     startHeartbeatTimer: (intervalMs, tick) => {
 *       const timer = setInterval(() => { void tick() }, intervalMs)
 *       return () => { clearInterval(timer) }
 *     },
 *   },
 *   { datasetCode: 1, triggerTypeCode: RegulatorySyncTriggerType.Scheduled },
 * )
 * ```
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type {
  DatasetLatestSyncStatus,
  RegulatorySyncContext,
  RegulatorySyncQueryContext,
  RunSyncInput,
  SyncLogListQuery,
  SyncLogPage,
  SyncOutcome,
} from './domain/regulatory-sync-model.ts'
import type { SyncableDatasetCode } from './domain/regulatory-sync-source.ts'
import { listLatestSyncStatuses as listLatestSyncStatusesImpl } from './impl/regulatory-sync.list-latest-status.service.ts'
import { listSyncLogs as listSyncLogsImpl } from './impl/regulatory-sync.list.service.ts'
import { runSync as runSyncImpl } from './impl/regulatory-sync.run.service.ts'

export type { RegulatorySyncContext, RegulatorySyncQueryContext }
export type {
  DatasetLatestSyncStatus,
  HeartbeatTick,
  FetchResource,
  RunSyncInput,
  StartHeartbeatTimer,
  StopHeartbeatTimer,
  SyncLogListQuery,
  SyncLogPage,
  SyncLogSortField,
  SyncLogSortOption,
  SyncLogSummary,
  SyncOutcome,
} from './domain/regulatory-sync-model.ts'
export {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_TIMEOUT_SECONDS,
  SYNC_LOG_SORT_FIELDS,
  resolveSyncLogSort,
} from './domain/regulatory-sync-model.ts'
/**
 * 有解析器的資料集清單，**排程器直接用這一份**。
 *
 * 原本排程器裡有第二份（`SCHEDULED_DATASETS`，一個 `satisfies Record<SyncableDatasetCode, true>`
 * 的物件），那份副本會漂移：它與來源設定分屬兩個目錄，而「新增一個解析器」與「把它排進每日同步」
 * 是兩次編輯。收成一份之後那個問題消失，而**「漏列會編譯不過」那道保護沒有跟著消失**——
 * 它搬到了 `domain/regulatory-sync-source.ts`：清單與 `REGULATORY_SYNC_SOURCES` 互相釘死，
 * 少列一個是 missing property、多列一個是 excess property，兩個方向都是編譯錯誤。
 */
export { isSyncableDatasetCode, SYNCABLE_DATASET_CODES } from './domain/regulatory-sync-source.ts'
export type { SyncableDatasetCode } from './domain/regulatory-sync-source.ts'

export const listSyncLogs = (
  context: RegulatorySyncQueryContext,
  query: SyncLogListQuery,
): Promise<ServiceResult<SyncLogPage>> => listSyncLogsImpl(context, query)

/**
 * 對一個資料集執行一次同步。
 *
 * **`datasetCode` 的型別是 {@link SyncableDatasetCode}，不是全部九個代碼**：
 * 「這個資料集有沒有解析器」是編譯期就確定的事實（見 `domain/regulatory-sync-source.ts`），
 * 因此 `runSync(context, { datasetCode: 2, … })` 是編譯錯誤，不需要一個執行期的錯誤碼。
 *
 * 失敗（`status_code=3`）回 `ServiceResult` 的失敗分支而不是一個帶狀態的成功值：
 * 後者會讓「跑完了」與「失敗了」在型別上完全一樣，於是排程器最自然的寫法是 log 一行然後
 * 跑下一個資料集——政府調了費率、解析器壞了，而告警一次都不會響（見 `*.errors.ts`）。
 */
export const runSync = (
  context: RegulatorySyncContext,
  input: RunSyncInput<SyncableDatasetCode>,
): Promise<ServiceResult<SyncOutcome>> => runSyncImpl(context, input)

/**
 * 多個資料集各自最近一次的同步狀態，不分成功或失敗。
 *
 * **無端點**：呼叫者是 `regulatory/datasets` 次目錄的 `overview` 動作（實作計畫 03 §3、任務一）。
 * 跨次目錄要資料一律走這裡，不得直接 import 本次目錄的 repository（§0.3）。
 */
export const listLatestSyncStatuses = (
  context: RegulatorySyncQueryContext,
  datasetCodes: readonly number[],
): Promise<readonly DatasetLatestSyncStatus[]> => listLatestSyncStatusesImpl(context, datasetCodes)
