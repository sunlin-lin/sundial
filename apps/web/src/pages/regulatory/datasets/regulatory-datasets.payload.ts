/**
 * 畫面上的查詢條件 → 送給後端的業務欄位（§1.3 的第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * 型別全部來自 `api/generated/`，本檔沒有任何描述 API 形狀的宣告（§3.2）。
 *
 * ## 這一頁的三支查詢共用一個基準日
 *
 * 總覽（`overview`）與內容（`resolve`）都吃 `asOfDate`，版本清單（`list`）不吃——
 * 版本清單是「這個資料集歷史上有哪幾版」，那份答案與基準日無關。這個差別要記住，
 * 因為它決定了改基準日時哪一段要重載（見 `.page.vue`）。
 */
import type {
  RegulatoryDatasetsListInput,
  RegulatoryDatasetsOverviewInput,
  RegulatoryDatasetsResolveInput,
} from '../../../api/generated/api-client.ts'

/** 資料集代碼。由產生型別推導，不在前端另列一份（§3.2）。 */
export type DatasetCode = RegulatoryDatasetsListInput['datasetCode']

/**
 * 版本清單的查詢，**排序一定有值**。
 *
 * 產生型別裡 `sort` 是選填，但前端不能省：§7.3 的回聲比對要拿「畫面上的排序」去比對回應裡的
 * `data.sort`，而省略時畫面上這一側是 `undefined`、回應那一側是後端補上的預設值，
 * **每一包回應都會比不過而被丟棄**——症狀是列表永遠空白、loading 永遠不關，而且沒有任何錯誤。
 */
export type VersionListQuery = RegulatoryDatasetsListInput & {
  readonly sort: NonNullable<RegulatoryDatasetsListInput['sort']>
}

/**
 * 每頁筆數。
 *
 * 比同步歷程的 20 小：版本清單是「有哪幾版」，而使用者要找的通常是最近幾版或某一個特定年度，
 * 一頁 10 筆讓分頁列在畫面上有實際作用（目前資料最多的資料集有 19 個版本）。
 * 不做「每頁幾筆」的選擇器：多一個控制項就多一個要進回聲比對的維度。
 */
export const VERSION_LIST_PER_PAGE = 10

/**
 * 排序：生效日由新到近舊。
 *
 * **明寫而不是靠後端預設**（理由見 {@link VersionListQuery}）。選生效日而不是同步時間：
 * 這一頁問的是「這份法規哪一版適用於哪一段期間」，而同步時間是「我們什麼時候抓到它」——
 * 回補歷史版本時後者會全部擠在同一天，排出來的順序沒有意義。
 */
export const VERSION_LIST_SORT = { field: 'effectiveFrom', order: 'desc' } as const

export const toOverviewQuery = (asOfDate: string): RegulatoryDatasetsOverviewInput => ({ asOfDate })

/**
 * @param currentPage 1 起算（§7.1）。換資料集時由呼叫端歸零回第 1 頁。
 */
export const toVersionListQuery = (
  datasetCode: DatasetCode,
  currentPage: number,
): VersionListQuery => ({
  datasetCode,
  currentPage,
  perPage: VERSION_LIST_PER_PAGE,
  sort: VERSION_LIST_SORT,
})

/**
 * 組出「看某一版的內容」那一次查詢。
 *
 * ⚠️ **`resolve` 是依基準日挑版本，不是依版本 id 取內容。** 後端沒有第二種取得 records 的方式：
 * `get` 只回版本的 metadata（`raw_data` 與 records 都不回）。因此「看某一版的內容」在這一頁
 * 實際上是「把基準日設到那一版的生效日，再解析一次」——見 `.page.vue` 的
 * `onVersionContentRequested`。
 *
 * 這不是繞路，它正好是計畫 §4.2 想教會使用者的那件事：**內容永遠是「某一天適用的那一版」**，
 * 而不是一個可以脫離時間單獨存在的東西。
 */
export const toResolveQuery = (
  datasetCode: DatasetCode,
  asOfDate: string,
): RegulatoryDatasetsResolveInput => ({ datasetCode, asOfDate })
