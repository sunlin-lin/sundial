/**
 * 法規資料集的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：
 * 業務拒絕一律以 `ServiceResult` 的失敗結果 ＋ 具名分組表達。這裡不是形式主義——
 * {@link resolveEffectiveDataset} 有**兩種呼叫者**（HTTP 端點與 Payroll 模組，計畫 §4.1），
 * 而 Payroll 那一側根本沒有 envelope 這包東西。
 *
 * ## `records[].data` 的型別：HTTP 側是聯集、service 側是收斂的，這個不對稱是刻意的
 *
 * 同一支 {@link resolveEffectiveDataset}，兩種呼叫者看到的 `data` 型別不同：
 *
 * | 呼叫者 | `datasetCode` 什麼時候知道 | `data` 的型別 |
 * |---|---|---|
 * | Payroll 等模組（`modules/regulatory/index.ts`） | 編譯期（原始碼裡就寫著 `1`） | **那一個資料集的形狀** |
 * | HTTP 端點 `/regulatory/datasets/resolve` | 執行期（前端送什麼是什麼） | **全部形狀的聯集** |
 *
 * **兩邊都是對的，而且來自同一個泛型參數，沒有第二份定義。** 差別只在推導的輸入：
 * 寫死 `1` 時 `TCode` 是 `1`，傳一個 `RegulatoryDatasetCode` 型別的變數時 `TCode` 就是整個聯集。
 *
 * 為什麼 HTTP 那一側**不該**跟著收斂：端點的 response schema 是對外契約，它要涵蓋這支端點
 * 可能回的每一種形狀（§2、§1.7 的 OpenAPI 契約）。收斂成某一個資料集的形狀不只是型別寫窄了
 * ——OpenAPI 上會變成「這支端點只回得出勞保分級表」，而它明明接受九個代碼。
 *
 * 為什麼 service 那一側**必須**收斂：Payroll 要的是「第 5 級的月投保薪資」，
 * 拿到聯集之後每次取值都得先寫一次 `'insuredCategoryCode' in data` 之類的收窄。
 * 那種收窄的分支是**寫得出來但永遠走不到**的，於是它的另一半（`else`）沒有任何測試涵蓋得到，
 * 而下一個人為了讓型別過關，最順手的寫法是一個 `as`——那才是真正的損失。
 *
 * 因此：**下面看到 `datasetCode` 泛型的地方不是過度設計，HTTP 那一側的聯集也不是漏改。**
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { RegulatoryDatasetCode } from './domain/regulatory-dataset-code.ts'
import type {
  DatasetVersionDetail,
  DatasetVersionListQuery,
  DatasetVersionPage,
  DatasetVersionTargetInput,
  EffectiveRegulatoryDataset,
  RegulatoryDatasetsContext,
  ResolveEffectiveDatasetInput,
} from './domain/regulatory-dataset-model.ts'
import { getDatasetVersion as getDatasetVersionImpl } from './impl/regulatory-datasets.get.service.ts'
import { listDatasetVersions as listDatasetVersionsImpl } from './impl/regulatory-datasets.list.service.ts'
import { resolveEffectiveDataset as resolveEffectiveDatasetImpl } from './impl/regulatory-datasets.resolve.service.ts'

export type { RegulatoryDatasetsContext }
export type {
  DatasetVersionDetail,
  DatasetVersionListQuery,
  DatasetVersionPage,
  DatasetVersionSortField,
  DatasetVersionSortOption,
  DatasetVersionSummary,
  DatasetVersionTargetInput,
  EffectiveRegulatoryDataset,
  RegulatoryRecordView,
  ResolveEffectiveDatasetInput,
} from './domain/regulatory-dataset-model.ts'
export { DATASET_VERSION_SORT_FIELDS, resolveDatasetVersionSort } from './domain/regulatory-dataset-model.ts'
export type { RegulatoryDatasetCode } from './domain/regulatory-dataset-code.ts'
export type { RegulatoryRecordData } from './domain/regulatory-record-shape.ts'

export const listDatasetVersions = (
  context: RegulatoryDatasetsContext,
  query: DatasetVersionListQuery,
): Promise<ServiceResult<DatasetVersionPage>> => listDatasetVersionsImpl(context, query)

export const getDatasetVersion = (
  context: RegulatoryDatasetsContext,
  input: DatasetVersionTargetInput,
): Promise<ServiceResult<DatasetVersionDetail | null>> => getDatasetVersionImpl(context, input)

/**
 * 依基準日取適用版本及其 records。
 *
 * **這一支同時有兩種呼叫者**（計畫 §4.1）：HTTP 端點 `/regulatory/datasets/resolve`（給前端顯示），
 * 以及 Payroll 等模組（經 `modules/regulatory/index.ts` 直接呼叫，**不打 HTTP**）。
 * 兩者共用同一份實作，差別只在失敗時看到的形狀（§3.1.3 vs `ServiceResult`，見 `*.errors.ts`），
 * 以及 `records[].data` 的型別寬窄——後者見檔頭那張表，那個不對稱是刻意的。
 *
 * @typeParam TCode 由 `input.datasetCode` 推導，**不必也不應該手動指定**：
 *   手寫 `resolveEffectiveDataset<1>(…, { datasetCode: someCode })` 會讓型別參數與實際傳進去的值
 *   有機會分岔，而分岔的症狀是 `data` 宣告成勞保分級表、實際上是別的資料集的內容
 *   ——形狀驗證仍然是對的（它看的是執行期的 `datasetCode`），只有型別在說謊。
 */
export const resolveEffectiveDataset = <TCode extends RegulatoryDatasetCode>(
  context: RegulatoryDatasetsContext,
  input: ResolveEffectiveDatasetInput<TCode>,
): Promise<ServiceResult<EffectiveRegulatoryDataset<TCode>>> => resolveEffectiveDatasetImpl(context, input)
