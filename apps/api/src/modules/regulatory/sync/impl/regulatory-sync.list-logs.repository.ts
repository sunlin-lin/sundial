/**
 * 資料存取：某一個資料集的同步歷程一頁 ＋ 總筆數（`/regulatory/sync/list`，計畫 §4.2）。
 *
 * 支撐索引 `ix_regulatory_sync_logs_dataset_started`（`dataset_code, started_at`）：
 * 兩段的順序就是查詢條件的順序——先鎖資料集，再由 `started_at` 排序。
 *
 * **沒有 `company_id` 條件，這不是漏掉**（§4.2）：本表是平台全域資料，沒有那一欄
 * （寫進來反而編譯不過——`TenantDatabase` 只接受 `CompanyScopedTable`）。
 *
 * 逐欄列出而不是 `SELECT *`：本表的 `error_message` 是 TEXT。它**要**回給前端（那是這張表的重點），
 * 但欄位一欄一欄寫出來的規則不因此放寬——日後加一欄不會自動出現在 API 上（§2）。
 */
import { asc, count, desc, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs } from '../../../../db/schema/index.ts'
import {
  toSyncLogSummary,
  type SyncLogListQuery,
  type SyncLogPage,
  type SyncLogSortField,
} from '../domain/regulatory-sync-model.ts'

/**
 * 排序欄位 → 資料表欄位。
 *
 * 參數型別已經是白名單聯集，因此這是一個**窮盡**的對照，沒有 `default` 分支：
 * 往白名單加一個欄位卻忘了在這裡對應，**當場編譯不過**——而寫一個 `default` 會讓那種情況
 * 靜靜退化成「依開始時間排序」，前端看到的順序與它要的不同，卻沒有任何錯誤。
 */
const sortColumn = (field: SyncLogSortField) => {
  switch (field) {
    case 'startedAt':
      return regulatorySyncLogs.startedAt
    case 'finishedAt':
      return regulatorySyncLogs.finishedAt
    case 'createdAt':
      return regulatorySyncLogs.createdAt
  }
}

/**
 * 取一頁同步歷程。
 *
 * 分頁與總筆數分成兩次查詢，不用視窗函式一次取回：兩者的 `WHERE` 完全相同，
 * 而總筆數不受 `LIMIT` 影響——寫成同一句反而要多一層子查詢，`EXPLAIN` 也跟著變得看不懂（§4.5）。
 *
 * **第二排序鍵固定是 `id DESC`**：同一秒內連續兩次同步（測試裡很常見）在只依 `started_at`
 * 排序時，兩列的先後不保證，於是同一列會同時出現在第 1 頁與第 2 頁，而另一列一頁都沒出現。
 */
export const listSyncLogPage = async (runner: QueryRunner, query: SyncLogListQuery): Promise<SyncLogPage> => {
  const condition = eq(regulatorySyncLogs.datasetCode, query.datasetCode)
  const direction = query.sort.order === 'desc' ? desc : asc

  const rows = await runner
    .select({
      id: regulatorySyncLogs.id,
      datasetCode: regulatorySyncLogs.datasetCode,
      triggerTypeCode: regulatorySyncLogs.triggerTypeCode,
      startedAt: regulatorySyncLogs.startedAt,
      finishedAt: regulatorySyncLogs.finishedAt,
      statusCode: regulatorySyncLogs.statusCode,
      datasetVersionId: regulatorySyncLogs.datasetVersionId,
      governmentResourceId: regulatorySyncLogs.governmentResourceId,
      recordsReceived: regulatorySyncLogs.recordsReceived,
      errorMessage: regulatorySyncLogs.errorMessage,
      heartbeatAt: regulatorySyncLogs.heartbeatAt,
      createdAt: regulatorySyncLogs.createdAt,
      updatedAt: regulatorySyncLogs.updatedAt,
    })
    .from(regulatorySyncLogs)
    .where(condition)
    .orderBy(direction(sortColumn(query.sort.field)), desc(regulatorySyncLogs.id))
    .limit(query.perPage)
    .offset((query.currentPage - 1) * query.perPage)

  const totals = await runner.select({ total: count() }).from(regulatorySyncLogs).where(condition)
  const [totalRow] = totals

  return { items: rows.map(toSyncLogSummary), totalCount: totalRow?.total ?? 0 }
}
