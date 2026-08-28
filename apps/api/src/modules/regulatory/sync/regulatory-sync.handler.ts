/**
 * 法規同步的端點 handler（§1.8.0 的④與⑥）。
 *
 * 只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。
 *
 * **本檔看不到 `runSync`**，那不是遺漏：人工觸發同步的端點依計畫 D3 不開放
 * （一家公司的管理者按一個鈕，平台上每一家公司的 Payroll 都跟著換版本，而平台管理員這個角色
 * 還不存在）。`runSync` 的呼叫者是伺服器端的程序，不經過 HTTP。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { RegulatoryDatasetCode } from '../datasets/regulatory-datasets.service.ts'
import {
  resolveSyncLogSort,
  type RegulatorySyncQueryContext,
  type SyncLogListQuery,
  type SyncLogPage,
  type SyncLogSortField,
  type SyncLogSummary,
} from './domain/regulatory-sync-model.ts'
import { listSyncLogs } from './regulatory-sync.service.ts'

/**
 * 由組裝點注入的相依。
 *
 * **只有 `db`**：這支端點是唯讀查詢，沒有公司範圍（法規三表是平台全域資料），
 * 也**沒有 `fetch` 與計時器**——給了它們就等於讓一支 HTTP 查詢有能力去打政府端點
 * （見 `domain/regulatory-sync-model.ts` 為什麼把 context 拆成兩個型別）。
 */
export type RegulatorySyncDependencies = RegulatorySyncQueryContext

/**
 * handler 需要的請求上下文。
 *
 * 刻意宣告成**結構型別**而不是 import Elysia 的 context 型別：這裡真正需要的只有三樣東西，
 * 而 Elysia 的 context 型別帶著一長串泛型參數，框架版本一升級就要逐支改。
 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  /** 只用來設定 HTTP status；status 與 envelope `code` 是同一次映射一起決定的（§1.8.1）。 */
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 確認這次請求真的經過了憑證驗證器。
 *
 * 本模組不需要身分裡的任何一個欄位（沒有 `companyId`），因此這個檢查看起來多餘。
 * 它擋的是另一件事：這支端點依計畫 §4.2 必須掛在**已登入群組**，而「掛錯群組」在程式碼上
 * 就是組裝點的一行差異、沒有任何測試會變紅——症狀是同步歷程對未登入者開放
 * （裡面有 `error_message`，那是系統內部狀態）。`session === null` 代表沒有任何憑證驗證器
 * 跑過（§1.9.2），那是**程式組裝錯誤**，因此走例外路徑（§3.1.2）。
 */
const requireAuthenticatedRequest = (session: RequestSession | null): void => {
  if (session === null) {
    throw new Error('法規同步端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
}

/**
 * 業務資料 → 本端點的 `data`。
 *
 * **必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的回傳值指派給 `data`，
 * 資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變。
 *
 * `errorMessage` **是刻意回出去的**：這張表存在的理由就是「失敗可追查」，把失敗原因藏起來
 * 等於它只剩下「有沒有跑過」。寫進那一欄的一律是我們自己組的訊息（哪一步、哪個值），
 * 不是例外的 stack（§3.2）。
 */
const toSyncLogSummaryData = (log: SyncLogSummary) => ({
  id: log.id,
  datasetCode: log.datasetCode,
  triggerTypeCode: log.triggerTypeCode,
  startedAt: log.startedAt,
  finishedAt: log.finishedAt,
  statusCode: log.statusCode,
  datasetVersionId: log.datasetVersionId,
  governmentResourceId: log.governmentResourceId,
  recordsReceived: log.recordsReceived,
  errorMessage: log.errorMessage,
  heartbeatAt: log.heartbeatAt,
  createdAt: log.createdAt,
  updatedAt: log.updatedAt,
})

type ListBody = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: SyncLogSortField; readonly order: 'asc' | 'desc' }
}

/** 搜尋條件的回聲（§1.4）。`datasetCode` 是必填，因此這一包永遠有值。 */
const toSearchEcho = (body: ListBody) => ({ datasetCode: body.datasetCode })

const toSyncLogListData = (query: SyncLogListQuery, body: ListBody, page: SyncLogPage) =>
  // `search` 與 `sort` 由**共用的** list 組裝函式帶回（§1.8.1），不讓端點自己填：
  // 這兩段是最常被忘記填的東西，而漏填是靜默的——前端的 race condition 防護當場失效。
  toListView(
    toSearchEcho(body),
    query.sort,
    { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
    page.items.map(toSyncLogSummaryData),
  )

/** 端點 `data` 的型別。由映射函式反推，因此**改了映射就會改型別**，不會兩邊漂移。 */
export type SyncLogListData = ReturnType<typeof toSyncLogListData>

export const handleSyncLogList = async (
  dependencies: RegulatorySyncDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<SyncLogListData>> => {
  requireAuthenticatedRequest(context.requestContext.session)
  const query: SyncLogListQuery = {
    datasetCode: context.body.datasetCode,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    // 預設排序在這裡補上，回聲的才會是**實際生效**的排序（§1.4）。
    sort: resolveSyncLogSort(context.body.sort),
  }

  const result = await listSyncLogs(dependencies, query)
  const outcome = resolveServiceResult(result, (page) => toSyncLogListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}
