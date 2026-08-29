/**
 * 業務動作：重算單一員工單一工作日的出勤判定（計畫 §4.1、§4.3.1）。
 *
 * **收 `TransactionRunner`，供 `revoke`／`revoke-other` 編排進同一筆交易，不自己開交易。**
 * 09／10 的驗收明文要求「撤銷後重新計算 `attendance_results`」；計畫 §4.3.1 進一步定案「兩種
 * 撤銷之後都要重算，沒有差別」。撤銷與重算若各自開一筆交易，會出現「撤銷已經 COMMIT、重算那筆
 * 交易卻失敗」的縫隙——畫面上撤銷看起來成功了，但判定結果沒有跟著更新，且沒有任何錯誤訊息會
 * 指向這個不一致（資料庫規範 §4.4「一次寫多表：唯一開交易的地方在編排入口」是同一個道理）。
 * 因此本函式不呼叫 `context.db.transaction(...)`，呼叫端必須把交易物件當第一個參數傳進來。
 *
 * **本階段永遠傳 `schedule: null`**：`resolveSchedule`（`domain/attendance-result-schedule.ts`）
 * 是一根樁，第 3 層排班上線時把它換成真正查詢即可，這裡不需要修改。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { computeAttendanceResult } from '../domain/attendance-result-engine.ts'
import { resolveSchedule } from '../domain/attendance-result-schedule.ts'
import type { RecalculateAttendanceResultInput } from '../domain/attendance-result-model.ts'
import { findAttendanceResultEventsForWorkDay, upsertAttendanceResults } from '../attendance-results.repository.ts'

export const recalculateAttendanceResultForWorkDay = async (
  tx: TransactionRunner,
  companyId: string,
  input: RecalculateAttendanceResultInput,
  now: string,
): Promise<void> => {
  const events = await findAttendanceResultEventsForWorkDay(tx, companyId, input.employeeId, input.workDate)
  const schedule = resolveSchedule(companyId, input.employeeId, input.workDate)
  const computation = computeAttendanceResult(events, schedule)

  await upsertAttendanceResults(tx, companyId, [
    {
      id: crypto.randomUUID(),
      employeeId: input.employeeId,
      employeeScheduleId: null,
      workDate: input.workDate,
      ...computation,
      calculatedAt: now,
      updatedAt: now,
    },
  ])
}
