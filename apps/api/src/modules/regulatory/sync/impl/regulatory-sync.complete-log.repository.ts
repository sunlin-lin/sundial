/**
 * 資料存取：把一列「執行中」的同步紀錄結案（`status_code` 2 成功／3 失敗／4 無異動）。
 *
 * ## 條件式 UPDATE，而且要檢查影響列數（§4.4）
 *
 * `WHERE` 裡帶著「預期的目前狀態」`status_code = 1`。這不是形式主義——本表的結案有兩個
 * 互相競爭的寫入者：同步程序自己，以及**下一次同步的心跳逾時判定**（它會把逾時的紀錄改成
 * `status_code=3`）。若沒有這個條件，一個被判死之後又活過來的程序會把自己的紀錄從
 * 「失敗（心跳逾時）」改寫成「成功」，於是那筆失敗紀錄消失，而它正是唯一的線索。
 *
 * 影響 0 列代表「這一列已經不是執行中了」，由呼叫端決定怎麼處置（見 run 切片）。
 */
import { and, eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { regulatorySyncLogs, RegulatorySyncStatus, type RegulatorySyncStatusValue } from '../../../../db/schema/index.ts'

export type CompleteSyncLogInput = {
  readonly id: number
  /** 只能是 2／3／4。`1 執行中` 不是結案狀態，寫進來會讓這一列永遠停在執行中。 */
  readonly statusCode: Exclude<RegulatorySyncStatusValue, typeof RegulatorySyncStatus.Running>
  /** 台北牆鐘 `YYYY-MM-DD HH:mm:ss`（§6）。同時寫進 `finished_at` 與 `updated_at`。 */
  readonly finishedAt: string
  /** 本次產生或辨識出的版本；失敗時為 `null`，`status=4` 時指向既有的那一版。 */
  readonly datasetVersionId: number | null
  readonly governmentResourceId: string | null
  readonly recordsReceived: number | null
  /** `status_code=3` 時必填（應用層保證，DDL 上寫不出「條件必填」）。 */
  readonly errorMessage: string | null
}

/** @returns 實際被更新的列數。0 代表這一列已經不是「執行中」（多半是已被判死）。 */
export const completeSyncLog = async (runner: QueryRunner, input: CompleteSyncLogInput): Promise<number> => {
  const [header] = await runner
    .update(regulatorySyncLogs)
    .set({
      statusCode: input.statusCode,
      finishedAt: input.finishedAt,
      datasetVersionId: input.datasetVersionId,
      governmentResourceId: input.governmentResourceId,
      recordsReceived: input.recordsReceived,
      errorMessage: input.errorMessage,
      updatedAt: input.finishedAt,
    })
    .where(
      and(eq(regulatorySyncLogs.id, input.id), eq(regulatorySyncLogs.statusCode, RegulatorySyncStatus.Running)),
    )

  return header.affectedRows
}
