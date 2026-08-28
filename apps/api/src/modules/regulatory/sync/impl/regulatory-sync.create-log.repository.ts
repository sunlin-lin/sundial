/**
 * 資料存取：登記一次同步（`regulatory_sync_logs` 的第一列，`status_code=1 執行中`）。
 *
 * **這一列必須在任何工作開始之前就寫進去，而且不在後面那個交易裡**（計畫 §7.1）：
 * 它的用途正是「有東西死在半路」時留下的痕跡，跟著交易回滾的話，
 * 崩潰的那一次就什麼都沒留下——而那正是最需要留紀錄的一次。
 *
 * 沒有 `company_id` 條件（平台全域資料，計畫 §3.2 (b)），走裸 db client 那條路（§4.2）。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import {
  regulatorySyncLogs,
  type RegulatorySyncStatusValue,
  type RegulatorySyncTriggerTypeValue,
} from '../../../../db/schema/index.ts'

export type CreateSyncLogInput = {
  readonly datasetCode: number
  readonly triggerTypeCode: RegulatorySyncTriggerTypeValue
  readonly statusCode: RegulatorySyncStatusValue
  /** 台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6）。四個時間欄位由同一個 `clock.now()` 產生。 */
  readonly startedAt: string
}

/**
 * 寫入一列並回傳它的 `id`。
 *
 * `heartbeat_at` 建立時與 `started_at` **同值**：這一欄是 `NOT NULL`（`db/schema` 上寫了理由——
 * 允許 NULL 的話判定就得多一條「NULL 算不算逾時」，而漏寫那一條的後果正好是它要防的狀態）。
 *
 * 取 id 用 `insertId` 而不是「寫完再用某個欄位反查」：本表**沒有任何唯一鍵**
 * （同一個資料集一天可以同步很多次，而且失敗的那幾次也要各留一列），反查沒有可靠的依據。
 */
export const createSyncLog = async (runner: QueryRunner, input: CreateSyncLogInput): Promise<number> => {
  const [header] = await runner.insert(regulatorySyncLogs).values({
    datasetCode: input.datasetCode,
    triggerTypeCode: input.triggerTypeCode,
    startedAt: input.startedAt,
    finishedAt: null,
    statusCode: input.statusCode,
    datasetVersionId: null,
    governmentResourceId: null,
    recordsReceived: null,
    errorMessage: null,
    heartbeatAt: input.startedAt,
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
  })

  return header.insertId
}
