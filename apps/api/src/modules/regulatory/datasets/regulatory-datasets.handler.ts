/**
 * 法規資料集的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 *
 * ## 本層唯一一段「不只是轉發」的邏輯：`resolve` 的失敗收斂
 *
 * `resolveEffectiveDataset` 對 Payroll 回 `ServiceResult` 的失敗分支，對前端則必須是
 * HTTP 200 ＋ `data: null`（§3.1.3、計畫 §4.4）。那個轉換只發生在 HTTP 這一側，
 * 因此它的位置就是 handler，見 {@link toResolveOutcome}。
 */
import { resolveServiceResult, type BoundaryResponse } from '../../../http/error-boundary.ts'
import { HttpStatus } from '../../../http/http-code-map.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import { ok, type EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { RegulatoryDatasetCode } from './domain/regulatory-dataset-code.ts'
import {
  resolveDatasetVersionSort,
  type DatasetVersionDetail,
  type DatasetVersionListQuery,
  type DatasetVersionPage,
  type DatasetVersionSortField,
  type DatasetVersionSummary,
  type EffectiveRegulatoryDataset,
  type RegulatoryDatasetsContext,
  type RegulatoryRecordView,
} from './domain/regulatory-dataset-model.ts'
import { RegulatoryDatasetErrorCode } from './regulatory-datasets.errors.ts'
import { getDatasetVersion, listDatasetVersions, resolveEffectiveDataset } from './regulatory-datasets.service.ts'

/**
 * 由組裝點注入的相依。
 *
 * **與其他模組不同，這裡就是完整的 context，沒有 `Omit<…, 'companyId'>`**：法規三表是平台全域
 * 資料，沒有公司範圍這個維度（計畫 §3.2 (b)）。**也沒有 clock**，理由見
 * `domain/regulatory-dataset-model.ts`——拿不到「現在」，就寫不出「`asOfDate` 沒帶就用今天」。
 */
export type RegulatoryDatasetsDependencies = RegulatoryDatasetsContext

/**
 * handler 需要的請求上下文。
 *
 * 刻意宣告成**結構型別**而不是 import Elysia 的 context 型別：這裡真正需要的只有三樣東西，
 * 而 Elysia 的 context 型別帶著一長串泛型參數，寫進每一支 handler 的簽章之後，
 * 框架版本一升級就要逐支改。傳進來的實際物件欄位更多，結構相容即可。
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
 * **本模組不需要身分裡的任何一個欄位**（沒有 `companyId`，見上），因此這個檢查看起來多餘。
 * 它擋的是另一件事：這三支端點依計畫 §4.2 必須掛在**已登入群組**，而「掛錯群組」
 * 在程式碼上就是組裝點的一行差異、沒有任何測試會變紅——症狀是法規端點對未登入者開放。
 * `session === null` 代表沒有任何憑證驗證器跑過（§1.9.2），那是**程式組裝錯誤**，
 * 因此走例外路徑（§3.1.2）：回一個業務錯誤會讓這個漏洞看起來像一次普通的操作失敗。
 */
const requireAuthenticatedRequest = (session: RequestSession | null): void => {
  if (session === null) {
    throw new Error('法規資料集端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
}

/**
 * 業務資料 → 本端點的 `data`。
 *
 * **必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的回傳值指派給 `data`，
 * 資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變。
 * 本模組沒有個資，但這條規則擋的另一半在這裡照樣成立——`raw_data` 就是那個
 * 「加進來沒人會發現」的欄位（計畫 §3.2 (c)、D3）。
 */
const toDatasetVersionSummaryData = (version: DatasetVersionSummary) => ({
  id: version.id,
  datasetCode: version.datasetCode,
  versionCode: version.versionCode,
  effectiveFrom: version.effectiveFrom,
  effectiveTo: version.effectiveTo,
  recordCount: version.recordCount,
  syncedAt: version.syncedAt,
  createdAt: version.createdAt,
})

const toDatasetVersionDetailData = (version: DatasetVersionDetail) => ({
  ...toDatasetVersionSummaryData(version),
  governmentResourceId: version.governmentResourceId,
  sourceModifiedAt: version.sourceModifiedAt,
  checksum: version.checksum,
  rawFormatCode: version.rawFormatCode,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableDatasetVersionDetailData = (version: DatasetVersionDetail | null) =>
  version === null ? null : toDatasetVersionDetailData(version)

/**
 * 一筆 record。
 *
 * 四個數值欄位原樣搬運 decimal 字串，**沒有任何 `Number(...)`**（§4.7、計畫 §6.1）：
 * 轉成 float 的那一刻精度就沒了，而級距在邊界值上會選錯級距——錯的是法定金額。
 */
const toRegulatoryRecordData = (record: RegulatoryRecordView) => ({
  id: record.id,
  recordKey: record.recordKey,
  code: record.code,
  name: record.name,
  rangeFrom: record.rangeFrom,
  rangeTo: record.rangeTo,
  amount: record.amount,
  rate: record.rate,
  data: record.data,
  sortOrder: record.sortOrder,
})

const toResolvedDatasetData = (resolved: EffectiveRegulatoryDataset) => ({
  datasetCode: resolved.datasetCode,
  asOfDate: resolved.asOfDate,
  version: toDatasetVersionDetailData(resolved.version),
  records: resolved.records.map(toRegulatoryRecordData),
})

type ListBody = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: DatasetVersionSortField; readonly order: 'asc' | 'desc' }
}

type TargetBody = { readonly id: number }

type ResolveBody = {
  readonly datasetCode: RegulatoryDatasetCode
  readonly asOfDate: string
}

/**
 * 搜尋條件的回聲（§1.4）。
 *
 * `datasetCode` 是必填，因此這一包永遠有值——它正是前端用來比對「這包回應是不是我現在
 * 畫面上這個資料集的清單」的依據。
 */
const toSearchEcho = (body: ListBody) => ({ datasetCode: body.datasetCode })

const toDatasetVersionListData = (query: DatasetVersionListQuery, body: ListBody, page: DatasetVersionPage) =>
  // `search` 與 `sort` 由**共用的** list 組裝函式帶回（§1.8.1），不讓端點自己填：
  // 這兩段是最常被忘記填的東西，而漏填是靜默的——前端的 race condition 防護當場失效。
  toListView(
    toSearchEcho(body),
    query.sort,
    { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
    page.items.map(toDatasetVersionSummaryData),
  )

/** 各端點 `data` 的型別。由映射函式反推，因此**改了映射就會改型別**，不會兩邊漂移。 */
export type DatasetVersionDetailData = ReturnType<typeof toDatasetVersionDetailData>
export type DatasetVersionListData = ReturnType<typeof toDatasetVersionListData>
export type ResolvedDatasetData = ReturnType<typeof toResolvedDatasetData>

/**
 * `resolve` 的結果 → HTTP 回應。
 *
 * **「該基準日沒有適用版本」在 HTTP 這一側是查詢類的查無資料，回 200 ＋ `data: null`**
 * （§3.1.3、計畫 §4.4）；同一筆錯誤對 Payroll 那一側仍然是 `ServiceResult` 的失敗分支。
 * 兩種形狀不是不一致，是兩種呼叫者對「這一天沒有資料」該做的事不同：
 * 前端顯示空狀態，Payroll 必須停下來（否則那個人的薪資單會安靜地消失）。
 *
 * 條件寫成「**有錯誤，而且每一筆都是** `no-effective-version`」而不是 `some(...)`：
 * `every` 對空陣列恆為 `true`，而「回了失敗卻沒有任何錯誤」是程式錯誤——
 * 那種情況必須落到 `resolveServiceResult`，由邊界層記一筆 log 並回 500（見 `error-boundary.ts`），
 * 不能被收斂成一句「查無資料」。
 */
const toResolveOutcome = (
  result: ServiceResult<EffectiveRegulatoryDataset>,
): BoundaryResponse<ResolvedDatasetData> | BoundaryResponse<null> => {
  if (
    !result.ok &&
    result.errors.length > 0 &&
    result.errors.every((error) => error.code === RegulatoryDatasetErrorCode.NoEffectiveVersion)
  ) {
    return { status: HttpStatus.Ok, body: ok(null) }
  }

  return resolveServiceResult(result, toResolvedDatasetData)
}

export const handleDatasetVersionList = async (
  dependencies: RegulatoryDatasetsDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<DatasetVersionListData>> => {
  requireAuthenticatedRequest(context.requestContext.session)
  const query: DatasetVersionListQuery = {
    datasetCode: context.body.datasetCode,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    // 預設排序在這裡補上，回聲的才會是**實際生效**的排序（§1.4）。
    sort: resolveDatasetVersionSort(context.body.sort),
  }

  const result = await listDatasetVersions(dependencies, query)
  const outcome = resolveServiceResult(result, (page) => toDatasetVersionListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleDatasetVersionGet = async (
  dependencies: RegulatoryDatasetsDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DatasetVersionDetailData | null>> => {
  requireAuthenticatedRequest(context.requestContext.session)
  const result = await getDatasetVersion(dependencies, { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableDatasetVersionDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDatasetVersionResolve = async (
  dependencies: RegulatoryDatasetsDependencies,
  context: EndpointContext<ResolveBody>,
): Promise<EndpointResult<ResolvedDatasetData | null>> => {
  requireAuthenticatedRequest(context.requestContext.session)
  const result = await resolveEffectiveDataset(dependencies, {
    datasetCode: context.body.datasetCode,
    // **原樣傳下去，不做任何補值**（計畫 §4.2）：`asOfDate` 是必填欄位，schema 已經擋過一次。
    asOfDate: context.body.asOfDate,
  })
  const outcome = toResolveOutcome(result)
  context.set.status = outcome.status
  return outcome.body
}
