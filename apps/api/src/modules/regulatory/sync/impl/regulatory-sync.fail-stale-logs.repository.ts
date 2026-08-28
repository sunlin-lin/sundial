/**
 * 資料存取：把心跳逾時的紀錄一次判死（`status_code=1` → `3 失敗`，計畫 §3.4）。
 *
 * **判死要留下失敗紀錄，不是直接忽略。** 資料字典要求「同步紀錄獨立保存每次下載、驗證與套用結果」，
 * 靜靜略過等於少了一次失敗紀錄，而那正是事後要查「為什麼那三天沒同步」時唯一的線索。
 *
 * ## 一句 UPDATE，不是逐列跑迴圈
 *
 * 逐列寫是 §4.5 那條「禁止在迴圈中逐筆查詢」的形狀，而且這裡沒有任何理由需要它：
 * 被判死的每一列寫的是**同一句** `error_message`（原因就是同一個：心跳停了）。
 *
 * `WHERE` 仍然帶 `status_code = 1`（§4.4 的條件式 UPDATE）：候選 id 是上一步撈出來的，
 * 兩步之間那幾毫秒內，那個程序有可能自己結案完成。少了這個條件就會把一次成功的同步
 * 改寫成「失敗（心跳逾時）」。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs, RegulatorySyncStatus } from '../../../../db/schema/index.ts'

export type FailStaleSyncLogsInput = {
  readonly ids: readonly number[]
  /** 台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6）。同時寫進 `finished_at` 與 `updated_at`。 */
  readonly finishedAt: string
  /** 失敗原因。`status_code=3` 時必填（應用層保證）。 */
  readonly errorMessage: string
}

/** @returns 實際被判死的列數。與 `ids.length` 不同是正常的（見檔頭的競態說明）。 */
export const failStaleSyncLogs = async (runner: QueryRunner, input: FailStaleSyncLogsInput): Promise<number> => {
  if (input.ids.length === 0) return 0

  const [header] = await runner
    .update(regulatorySyncLogs)
    .set({
      statusCode: RegulatorySyncStatus.Failed,
      finishedAt: input.finishedAt,
      errorMessage: input.errorMessage,
      updatedAt: input.finishedAt,
    })
    .where(
      and(
        inArray(regulatorySyncLogs.id, [...input.ids]),
        eq(regulatorySyncLogs.statusCode, RegulatorySyncStatus.Running),
      ),
    )

  return header.affectedRows
}
