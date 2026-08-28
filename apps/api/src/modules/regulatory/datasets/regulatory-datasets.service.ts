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
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
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
 * 兩者共用同一份實作，差別只在失敗時看到的形狀（§3.1.3 vs `ServiceResult`，見 `*.errors.ts`）。
 */
export const resolveEffectiveDataset = (
  context: RegulatoryDatasetsContext,
  input: ResolveEffectiveDatasetInput,
): Promise<ServiceResult<EffectiveRegulatoryDataset>> => resolveEffectiveDatasetImpl(context, input)
