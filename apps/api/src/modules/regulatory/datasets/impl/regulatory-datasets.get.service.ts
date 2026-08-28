/**
 * 業務動作：查詢單一版本的 metadata（不含 `raw_data`）。
 *
 * **查不到回 `null`，不是業務錯誤**（§3.1.3）：查詢的語意是「有就給我」，查無此筆是一個正常且
 * 有效的答案。因此錯誤字典裡刻意沒有 `version-not-found`（計畫 §4.4）——多開一個 not-found 碼
 * 會讓這支端點的「查無資料」跟全站其他查詢端點長得不一樣。
 *
 * 這一層看起來只是一行轉發，但它不能省略：**所有呼叫都必須經過入口**（§0.4），
 * 而 `impl/` 底下的切片只允許被自己次目錄的入口檔 import。少了它，handler 就會直接碰 repository。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type {
  DatasetVersionDetail,
  DatasetVersionTargetInput,
  RegulatoryDatasetsContext,
} from '../domain/regulatory-dataset-model.ts'
import { findDatasetVersion } from '../regulatory-datasets.repository.ts'

export const getDatasetVersion = async (
  context: RegulatoryDatasetsContext,
  input: DatasetVersionTargetInput,
): Promise<ServiceResult<DatasetVersionDetail | null>> => succeed(await findDatasetVersion(context.db, input.id))
