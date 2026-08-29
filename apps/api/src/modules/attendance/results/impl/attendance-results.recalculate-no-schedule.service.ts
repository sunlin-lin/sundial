/**
 * 業務動作：重算全部 `NO_SCHEDULE` 紀錄（計畫 §4.1、§5 Stage 4）。
 *
 * **存在的理由**：排班（第 3 層）上線之前，出勤判定只會產生 `NO_SCHEDULE`；排班上線後，
 * `resolveSchedule`（`domain/attendance-result-schedule.ts`）換成真正查詢，但既有的
 * `NO_SCHEDULE` 歷史紀錄不會自己變成對照班表的判定——沒有這支動作，排班上線前的歷史紀錄會
 * 永遠停在未判定狀態（計畫 §4.1 原文）。
 *
 * **固定三次資料庫往返，不隨待重算筆數增加**（`sundial-backend` skill §4.5、`check:n-plus-one`
 * 適用）：
 *
 * 1. 查全公司目前 `NO_SCHEDULE` 的座標清單（`findNoScheduleAttendanceResults`）。
 * 2. 依這批座標涉及的員工與工作日，一次查出全部相關的有效打卡事件（`findAttendanceResultEventRows`）。
 * 3. 一次批次 `INSERT ... ON DUPLICATE KEY UPDATE` 寫回全部重算結果（`upsertAttendanceResults`）。
 *
 * 中間的分組與計算（`groupAttendanceEventsByEmployeeWorkDate`、逐筆呼叫
 * `computeAttendanceResult`）都是純記憶體運算，沒有任何一步在迴圈裡呼叫資料庫。
 *
 * **不開交易。** 這是一個等冪的維護性重算：即使執行期間有新的撤銷或打卡發生，也只是下一次執行
 * 這支動作時會再重算一次、結果更精確，不會因為沒有交易包住整批而產生資料不一致——這與
 * `revoke`／`revoke-other` 撤銷後的單筆重算不同（那個場景必須與撤銷同一筆交易，見
 * `attendance-results.recalculate-work-day.service.ts` 檔頭），這裡沒有一個「必須跟誰同時成功
 * 或同時失敗」的配對動作。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { computeAttendanceResult } from '../domain/attendance-result-engine.ts'
import {
  groupAttendanceEventsByEmployeeWorkDate,
  lookupAttendanceEvents,
} from '../domain/attendance-result-event-grouping.ts'
import { resolveSchedule } from '../domain/attendance-result-schedule.ts'
import type { AttendanceResultsContext } from '../domain/attendance-result-context.ts'
import type { RecalculateAllNoScheduleResult } from '../domain/attendance-result-model.ts'
import {
  findAttendanceResultEventRows,
  findNoScheduleAttendanceResults,
  upsertAttendanceResults,
} from '../attendance-results.repository.ts'

export const recalculateAllNoScheduleAttendanceResults = async (
  context: AttendanceResultsContext,
): Promise<ServiceResult<RecalculateAllNoScheduleResult>> => {
  const now = context.clock.now()

  // ① 待重算座標，一次查完。
  const pending = await findNoScheduleAttendanceResults(context.db, context.companyId)
  if (pending.length === 0) return succeed({ recalculatedCount: 0 })

  // ② 這批座標涉及的全部有效事件，一次查完（去重後的員工／工作日清單，見 repository 檔頭
  // 「回傳的是兩個 IN 條件的交集」）。
  const employeeIds = [...new Set(pending.map((item) => item.employeeId))]
  const workDates = [...new Set(pending.map((item) => item.workDate))]
  const eventRows = await findAttendanceResultEventRows(context.db, context.companyId, employeeIds, workDates)
  const eventsByEmployeeWorkDate = groupAttendanceEventsByEmployeeWorkDate(eventRows)

  // ③ 純記憶體計算，沒有任何資料庫呼叫（§4.5：迴圈裡不得有 DB 的 await）。
  const rows = pending.map((item) => {
    const events = lookupAttendanceEvents(eventsByEmployeeWorkDate, item.employeeId, item.workDate)
    const schedule = resolveSchedule(context.companyId, item.employeeId, item.workDate)
    const computation = computeAttendanceResult(events, schedule)
    return {
      id: crypto.randomUUID(),
      employeeId: item.employeeId,
      employeeScheduleId: null,
      workDate: item.workDate,
      ...computation,
      calculatedAt: now,
      updatedAt: now,
    }
  })

  // ④ 一次批次寫回。
  await upsertAttendanceResults(context.db, context.companyId, rows)

  return succeed({ recalculatedCount: rows.length })
}
