/**
 * 業務動作：查詢某個資料集的同步歷程（`/regulatory/sync/list`）。
 *
 * 查詢類端點**沒有業務錯誤**（§3.1.3）：查無資料是一個正常且有效的答案，回空清單而不是錯誤
 * ——當成錯誤的話，前端就得為「這個資料集還沒同步過」寫錯誤處理，而那在九個資料集裡目前是八個的常態。
 *
 * 本模組沒有跨公司存取這個維度：三張表是平台全域資料，沒有 `company_id`（計畫 §3.2 (b)）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type {
  RegulatorySyncQueryContext,
  SyncLogListQuery,
  SyncLogPage,
} from '../domain/regulatory-sync-model.ts'
import { listSyncLogPage } from '../regulatory-sync.repository.ts'

export const listSyncLogs = async (
  context: RegulatorySyncQueryContext,
  query: SyncLogListQuery,
): Promise<ServiceResult<SyncLogPage>> => succeed(await listSyncLogPage(context.db, query))
