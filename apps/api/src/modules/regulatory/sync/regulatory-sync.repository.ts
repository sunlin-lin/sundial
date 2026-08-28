/**
 * 法規同步的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 這裡的「動作」是**資料存取動作，不是端點動作**（§0.4）：本次目錄只有一支端點，
 * 底下卻有九個資料存取動作——同步流程本身就是一連串對資料庫的獨立操作
 * （登記、判死、比 checksum、列出已有的版本代碼、寫版本、寫內容、結案），
 * 而它們各自也被不同的分支用到。
 *
 * 本檔（含 `impl/`）是本次目錄唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）。
 *
 * ## 這裡會寫 `datasets` 那兩張表，而那是刻意的
 *
 * {@link insertDatasetVersion} 與 {@link insertRegulatoryRecords} 寫的是
 * `regulatory_dataset_versions` 與 `regulatory_records`——`datasets` 次目錄讀的那兩張。
 * 這不是繞過對方的 service：計畫 §4 就是這樣分工的（`datasets` 讀、`sync` 寫），
 * 而 §0.3 禁止的是 **import 對方的 repository**，不是「碰同一張表」。
 * 兩邊各自持有自己方向的查詢，於是讀那一側永遠不會意外拖進 HTTP fetch 與解析器。
 *
 * ## 三張表都走裸 db client，不經過 `TenantDatabase`
 *
 * 法規是全國法定值、全平台共用一份（計畫 §3.2 (b)）。§4.2「每一次查詢都必須帶 `company_id`」
 * 在這三張表上**沒有適用對象**——寫進來反而編譯失敗，因為 `TenantDatabase` 只接受
 * `CompanyScopedTable`，而它們刻意不在那個聯集裡。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type {
  DatasetLatestSyncStatus,
  RunningSyncLog,
  SyncLogListQuery,
  SyncLogPage,
} from './domain/regulatory-sync-model.ts'
import {
  completeSyncLog as completeSyncLogImpl,
  type CompleteSyncLogInput,
} from './impl/regulatory-sync.complete-log.repository.ts'
import {
  createSyncLog as createSyncLogImpl,
  type CreateSyncLogInput,
} from './impl/regulatory-sync.create-log.repository.ts'
import {
  failStaleSyncLogs as failStaleSyncLogsImpl,
  type FailStaleSyncLogsInput,
} from './impl/regulatory-sync.fail-stale-logs.repository.ts'
import {
  findLatestDatasetVersion as findLatestDatasetVersionImpl,
  type LatestDatasetVersion,
} from './impl/regulatory-sync.find-latest-version.repository.ts'
import {
  findDatasetVersionByCode as findDatasetVersionByCodeImpl,
  type DatasetVersionIdentity,
} from './impl/regulatory-sync.find-version-by-code.repository.ts'
import {
  insertRegulatoryRecords as insertRegulatoryRecordsImpl,
  type InsertRegulatoryRecordInput,
} from './impl/regulatory-sync.insert-records.repository.ts'
import {
  insertDatasetVersion as insertDatasetVersionImpl,
  type InsertDatasetVersionInput,
} from './impl/regulatory-sync.insert-version.repository.ts'
import { listSyncLogPage as listSyncLogPageImpl } from './impl/regulatory-sync.list-logs.repository.ts'
import { listLatestSyncStatuses as listLatestSyncStatusesImpl } from './impl/regulatory-sync.list-latest-status.repository.ts'
import { listDatasetVersionCodes as listDatasetVersionCodesImpl } from './impl/regulatory-sync.list-version-codes.repository.ts'
import { listRunningSyncLogs as listRunningSyncLogsImpl } from './impl/regulatory-sync.list-running-logs.repository.ts'
import { touchSyncLogHeartbeat as touchSyncLogHeartbeatImpl } from './impl/regulatory-sync.touch-heartbeat.repository.ts'

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別。
 *
 * **連線池與交易物件都滿足它**，因此同一段 repository 程式碼在交易內外是同一個用法
 * ——這正是「交易邊界屬於 service」（§4.4）能成立的前提：寫版本與寫 records 由 service 包進
 * 同一個交易，而這兩支切片完全不知道自己在不在交易裡。
 */
export type { QueryRunner }

export type {
  CompleteSyncLogInput,
  CreateSyncLogInput,
  DatasetVersionIdentity,
  FailStaleSyncLogsInput,
  InsertDatasetVersionInput,
  InsertRegulatoryRecordInput,
  LatestDatasetVersion,
}

export type { DatasetLatestSyncStatus }

export const createSyncLog = (runner: QueryRunner, input: CreateSyncLogInput): Promise<number> =>
  createSyncLogImpl(runner, input)

export const listRunningSyncLogs = (runner: QueryRunner, datasetCode: number): Promise<readonly RunningSyncLog[]> =>
  listRunningSyncLogsImpl(runner, datasetCode)

export const failStaleSyncLogs = (runner: QueryRunner, input: FailStaleSyncLogsInput): Promise<number> =>
  failStaleSyncLogsImpl(runner, input)

export const completeSyncLog = (runner: QueryRunner, input: CompleteSyncLogInput): Promise<number> =>
  completeSyncLogImpl(runner, input)

export const touchSyncLogHeartbeat = (runner: QueryRunner, id: number, at: string): Promise<number> =>
  touchSyncLogHeartbeatImpl(runner, id, at)

export const findLatestDatasetVersion = (
  runner: QueryRunner,
  datasetCode: number,
): Promise<LatestDatasetVersion | null> => findLatestDatasetVersionImpl(runner, datasetCode)

export const listDatasetVersionCodes = (runner: QueryRunner, datasetCode: number): Promise<readonly string[]> =>
  listDatasetVersionCodesImpl(runner, datasetCode)

export const findDatasetVersionByCode = (
  runner: QueryRunner,
  datasetCode: number,
  versionCode: string,
): Promise<DatasetVersionIdentity | null> => findDatasetVersionByCodeImpl(runner, datasetCode, versionCode)

export const insertDatasetVersion = (runner: QueryRunner, input: InsertDatasetVersionInput): Promise<number> =>
  insertDatasetVersionImpl(runner, input)

export const insertRegulatoryRecords = (
  runner: QueryRunner,
  rows: readonly InsertRegulatoryRecordInput[],
): Promise<void> => insertRegulatoryRecordsImpl(runner, rows)

export const listSyncLogPage = (runner: QueryRunner, query: SyncLogListQuery): Promise<SyncLogPage> =>
  listSyncLogPageImpl(runner, query)

/** 多個資料集各自最近一次的同步狀態，不分成功或失敗（總覽用，任務一）。 */
export const listLatestSyncStatuses = (
  runner: QueryRunner,
  datasetCodes: readonly number[],
): Promise<readonly DatasetLatestSyncStatus[]> => listLatestSyncStatusesImpl(runner, datasetCodes)
