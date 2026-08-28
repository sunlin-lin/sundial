/**
 * 業務動作：多個資料集各自最近一次的同步狀態（不分成功或失敗）。
 *
 * **沒有對應的端點**：呼叫者是 `regulatory/datasets` 次目錄的 `overview` 動作（§0.3 允許
 * 同一大目錄內的次目錄互相呼叫對方的 service；不得碰的是對方的 repository）。
 *
 * 純轉手也要有：這是本次目錄唯一可以碰資料庫的一層（§0.3），跨次目錄要資料一律走這裡，
 * 不能讓 `datasets` 直接 import 本次目錄的 repository。
 *
 * **查詢類，沒有業務規則可以不成立**：不回 `ServiceResult`，比照
 * `sessions/main` 那幾個「無端點動作」（`verifyAccessToken` 等）的處置。
 */
import type { RegulatorySyncQueryContext, DatasetLatestSyncStatus } from '../domain/regulatory-sync-model.ts'
import { listLatestSyncStatuses as listLatestSyncStatusesFromDb } from '../regulatory-sync.repository.ts'

export const listLatestSyncStatuses = (
  context: RegulatorySyncQueryContext,
  datasetCodes: readonly number[],
): Promise<readonly DatasetLatestSyncStatus[]> => listLatestSyncStatusesFromDb(context.db, datasetCodes)
