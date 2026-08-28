/**
 * 資料存取：**多個資料集各自最近一次**的同步紀錄，不分狀態（`regulatory/datasets` 的
 * `overview` 動作用，實作計畫 03 §3、任務一）。
 *
 * ## 這是批次版本，不是對單一資料集查詢的迴圈呼叫
 *
 * 總覽要九個資料集各自的答案。逐一呼叫「查某個資料集最近一次同步」會是九次資料庫往返
 * ——那正是後端規範 §4.5 禁止的形狀（一頁 20 筆資料各查一次關聯主檔）。這裡改成
 * **一次查詢涵蓋全部資料集代碼**，`ORDER BY dataset_code, started_at DESC, id DESC` 之後，
 * 在記憶體裡對已排序好的結果做一次濾重（同一個 `dataset_code` 只留第一次出現的那一列）
 * 即可取出各資料集的最新一筆。SQL 沒有跨資料庫都通用的「每組取一筆」語法（MariaDB 直到
 * 10.2 才有視窗函式，且全站目前沒有先例），這個「排序 ＋ 濾重」的組合是**單一查詢**，
 * 不是逐筆查詢的另一種寫法。
 *
 * `ORDER BY` 的次要鍵（`id DESC`）與 `list-logs.repository.ts` 逐字相同：兩者都要在
 * 同一秒內有多筆紀錄時穩定挑出同一筆，理由見該檔。
 */
import { asc, desc, inArray } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs } from '../../../../db/schema/index.ts'
import { isRegulatoryDatasetCode } from '../../datasets/domain/regulatory-dataset-model.ts'
import type { DatasetLatestSyncStatus } from '../domain/regulatory-sync-model.ts'

export const listLatestSyncStatuses = async (
  runner: QueryRunner,
  datasetCodes: readonly number[],
): Promise<readonly DatasetLatestSyncStatus[]> => {
  // 空清單不必打資料庫：讓「呼叫端忘了傳資料集代碼」與「查詢正常、剛好沒有任何紀錄」
  // 變成同一種結果。
  if (datasetCodes.length === 0) return []

  const rows = await runner
    .select({
      datasetCode: regulatorySyncLogs.datasetCode,
      startedAt: regulatorySyncLogs.startedAt,
      finishedAt: regulatorySyncLogs.finishedAt,
      statusCode: regulatorySyncLogs.statusCode,
    })
    .from(regulatorySyncLogs)
    .where(inArray(regulatorySyncLogs.datasetCode, datasetCodes))
    .orderBy(asc(regulatorySyncLogs.datasetCode), desc(regulatorySyncLogs.startedAt), desc(regulatorySyncLogs.id))

  const seen = new Set<number>()
  const result: DatasetLatestSyncStatus[] = []
  for (const row of rows) {
    // 已排序成「同一資料集的最新一筆先出現」，因此每個 `dataset_code` 只需要收下第一次遇到的那一列。
    if (seen.has(row.datasetCode)) continue
    seen.add(row.datasetCode)

    const { datasetCode } = row
    if (!isRegulatoryDatasetCode(datasetCode)) {
      // 系統錯誤而非業務拒絕（§3.1.2）：資料庫裡出現一列指向不存在的資料集，
      // 代表有人手動寫入或某支 migration 寫錯，不是使用者做錯了什麼。
      throw new Error(`regulatory_sync_logs 的 dataset_code=${String(datasetCode)} 不在資料集清單內（計畫 §3.1）`)
    }

    result.push({ datasetCode, startedAt: row.startedAt, finishedAt: row.finishedAt, statusCode: row.statusCode })
  }
  return result
}
