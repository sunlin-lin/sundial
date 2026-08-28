/**
 * 業務動作：查詢某個資料集的版本清單。
 *
 * 查詢類端點**沒有業務錯誤**（§3.1.3）：查無資料是一個正常且有效的答案，回空清單而不是錯誤
 * ——當成錯誤的話，前端就得為「這個資料集還沒有任何版本」寫錯誤處理，而那在 Stage 3 開始同步
 * 之前是九個資料集的常態。
 *
 * 本模組沒有跨公司存取這個維度：三張表是平台全域資料，沒有 `company_id`（計畫 §3.2 (b)）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type {
  DatasetVersionListQuery,
  DatasetVersionPage,
  RegulatoryDatasetsContext,
} from '../domain/regulatory-dataset-model.ts'
import { listDatasetVersionPage } from '../regulatory-datasets.repository.ts'

export const listDatasetVersions = async (
  context: RegulatoryDatasetsContext,
  query: DatasetVersionListQuery,
): Promise<ServiceResult<DatasetVersionPage>> => succeed(await listDatasetVersionPage(context.db, query))
