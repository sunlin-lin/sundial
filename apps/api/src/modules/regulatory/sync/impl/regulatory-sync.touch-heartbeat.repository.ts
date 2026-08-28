/**
 * 資料存取：推進一列同步紀錄的 `heartbeat_at`（計畫 §3.4、決策 D2）。
 *
 * 這是「同步程序還活著」這個訊號的唯一寫入點。呼叫它的是一個**獨立計時器**，不是工作步驟
 * ——理由寫在 `domain/regulatory-sync-model.ts` 的 `StartHeartbeatTimer` 上。
 *
 * `WHERE` 帶 `status_code = 1`（§4.4 的條件式 UPDATE）有兩個作用：
 *
 * - 已結案的紀錄不會被心跳「復活」成一個看起來還在跑的東西；
 * - 影響 0 列是一個**有意義的訊號**：這一列已經不是執行中（多半是被下一次同步判死了），
 *   呼叫端據此把計時器停掉，而不是每 60 秒對一列已經結案的紀錄空打一次 UPDATE。
 */
import { and, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs, RegulatorySyncStatus } from '../../../../db/schema/index.ts'

/**
 * @param at 台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6），由呼叫端的 clock 產生（§6.2）。
 * @returns 實際被更新的列數。0 代表這一列已經不是「執行中」。
 */
export const touchSyncLogHeartbeat = async (runner: QueryRunner, id: number, at: string): Promise<number> => {
  const [header] = await runner
    .update(regulatorySyncLogs)
    // `updated_at` 一起推進：本表的列會被修改，因此它不在 §1.4「append-only 免 updated_at」
    // 的補集裡（見 `db/schema/regulatory-sync-logs.ts` 對三個時間欄位的分工說明）。
    .set({ heartbeatAt: at, updatedAt: at })
    .where(and(eq(regulatorySyncLogs.id, id), eq(regulatorySyncLogs.statusCode, RegulatorySyncStatus.Running)))

  return header.affectedRows
}
