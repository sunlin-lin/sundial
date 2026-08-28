/**
 * 資料存取：某個資料集目前有哪些「執行中」的同步紀錄。
 *
 * 這支查詢**每次同步啟動時都會先跑一次**，而且它是同步流程的第一步——它慢，每一次同步都跟著慢。
 * 支撐索引是 `ix_regulatory_sync_logs_dataset_status`（`dataset_code, status_code, heartbeat_at`），
 * 三段順序即條件順序（見 `db/schema/regulatory-sync-logs.ts`）。
 *
 * ## 為什麼查「全部執行中的」而不是直接查「心跳逾時的」
 *
 * 把時間門檻寫進 `WHERE`（`heartbeat_at < ?`）看起來更省，但那樣**判定規則會有兩份實作**：
 * 一份在 SQL 裡，一份在測試那條純函式上（`isHeartbeatStale`）。它們會分岔，而分岔的方向若是
 * SQL 那份比較寬鬆，活著的程序會被判死，第二個程序接手同時寫入同一個版本。
 *
 * 判定留在 `domain/`（純函式、測得到），這一層只負責把候選撈出來——而候選最多就是幾列
 * （同一個資料集同時「執行中」的紀錄不會多）。
 */
import { and, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs, RegulatorySyncStatus } from '../../../../db/schema/index.ts'
import type { RunningSyncLog } from '../domain/regulatory-sync-model.ts'

/** 只取判定需要的兩欄；`error_message` 是 TEXT，撈出來只為了丟掉沒有意義。 */
export const listRunningSyncLogs = async (
  runner: QueryRunner,
  datasetCode: number,
): Promise<readonly RunningSyncLog[]> =>
  runner
    .select({ id: regulatorySyncLogs.id, heartbeatAt: regulatorySyncLogs.heartbeatAt })
    .from(regulatorySyncLogs)
    .where(
      and(
        eq(regulatorySyncLogs.datasetCode, datasetCode),
        eq(regulatorySyncLogs.statusCode, RegulatorySyncStatus.Running),
      ),
    )
