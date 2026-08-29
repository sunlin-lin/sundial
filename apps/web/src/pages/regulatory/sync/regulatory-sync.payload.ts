/**
 * 畫面上的查詢條件 → 送給後端的業務欄位（§1.3 的第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * 型別全部來自 `api/generated/`，本檔沒有任何描述 API 形狀的宣告（§3.2）：
 * 後端把 `datasetCode` 的合法值改掉、或把 `sort.field` 的可選欄位改掉，這裡當場編譯錯誤。
 */
import type { RegulatorySyncListInput } from '../../../api/generated/api-client.ts'

/** 資料集代碼。由產生型別推導，不在前端另列一份（§3.2）。 */
export type SyncDatasetCode = RegulatorySyncListInput['datasetCode']

/**
 * 送出的查詢，**排序一定有值**。
 *
 * 產生型別裡 `sort` 是選填（後端不給就套預設「開始時間由新到舊」），但前端不能省：
 * §7.3 的回聲比對要拿「畫面上的排序」去比對回應裡的 `data.sort`，而省略時畫面上這一側是
 * `undefined`、回應那一側是後端補上的預設值，**每一包回應都會比不過而被丟棄**——
 * 症狀是列表永遠空白、loading 永遠不關，而且沒有任何錯誤。
 */
export type SyncListQuery = RegulatorySyncListInput & {
  readonly sort: NonNullable<RegulatorySyncListInput['sort']>
}

/**
 * 每頁筆數。與後端的預設值相同（`perPage` 預設 20，§7.1）。
 *
 * 不做「每頁幾筆」的選擇器：這一頁是拿來回答「最近幾次同步的結果如何」的，
 * 多一個控制項就多一個要進回聲比對與網址狀態的維度，而沒有人會需要一次看 100 筆同步紀錄。
 */
export const SYNC_LIST_PER_PAGE = 20

/**
 * 排序：開始時間由新到舊。
 *
 * 與後端的 `DEFAULT_SYNC_LOG_SORT` 相同，但**明寫而不是靠預設**（理由見 {@link SyncListQuery}）。
 * 不做欄位排序 UI：三個可排序欄位裡只有 `startedAt` 回答得了「最近一次同步是什麼時候」，
 * 另外兩個在正常流程下與它等價（見後端 `regulatory-sync-model.ts` 的說明）。
 */
export const SYNC_LIST_SORT = { field: 'startedAt', order: 'desc' } as const

/**
 * 預設選的資料集：勞保投保薪資分級表。它是薪資結算最常被回頭核對的一份。
 *
 * 這個常數原本在 `.dataset.view.ts`（那一份手寫的「代碼 → 名稱」對照）裡，
 * 那個檔案已經整個刪掉——名稱現在直接來自 `regulatory.sync.list` 自己的回應
 *（`datasets`，見 `.view.ts` 檔頭）。「預設選哪一個」不是名稱的一部分，
 * 它是查詢條件的預設值，因此留在這裡。
 */
export const DEFAULT_DATASET_CODE: SyncDatasetCode = 1

/**
 * 組出一次同步歷程查詢。
 *
 * **沒有公司欄位，日後也不得加**（計畫 §2.1）：`regulatory_sync_logs` 沒有 `company_id`，
 * 政府法規是全國一份。加了公司篩選之後那個條件會一路傳到後端，逼出一個「法規資料要不要分公司」
 * 的假問題；公司自己的選擇（用哪一個職災行業別）在 `company_regulatory_settings`，是另一張表。
 *
 * @param datasetCode 後端**必填**：這支端點一次只查一個資料集，因此畫面上必須有選擇器。
 * @param currentPage 1 起算（§7.1）。篩選條件變更時由呼叫端歸零回第 1 頁。
 */
export const toSyncListQuery = (datasetCode: SyncDatasetCode, currentPage: number): SyncListQuery => ({
  datasetCode,
  currentPage,
  perPage: SYNC_LIST_PER_PAGE,
  sort: SYNC_LIST_SORT,
})
