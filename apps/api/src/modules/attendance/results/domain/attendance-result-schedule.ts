/**
 * ★ 這是一根樁（stub），不是真的查詢。形狀比照 `attendance/records/domain/
 * attendance-record-period-lock.ts` 的 `isPeriodLocked`。
 *
 * 判定引擎 `computeAttendanceResult`（`attendance-result-engine.ts`）需要一個 `Schedule | null`
 * 才能決定要不要走對照班表的分支。這個班表要從哪裡查，答案是 `employee_schedules`
 * （第 3 層排班），**但那張表現在還不存在**——本函式現階段固定回傳 `null`，因此判定引擎永遠
 * 走 `NO_SCHEDULE` 分支（計畫 §4.1）。
 *
 * **第 3 層排班上線時要做的事**：把這支函式改成依 `companyId`／`employeeId`／`workDate` 查
 * `employee_schedules` 找出這個員工這個工作日適用的排班，再從 `shift_definitions`／
 * `shift_work_periods`（`db/schema/shift-definitions.ts`／`shift-work-periods.ts`，已於
 * 第 1 層完成）組出 `Schedule`（見 `attendance-result-model.ts` 該型別檔頭）。呼叫端
 * （`impl/attendance-results.recalculate-work-day.service.ts`、批次重算動作）不需要跟著改
 * ——兩者都只依賴這支函式的簽章，不知道也不需要知道內部怎麼查。
 */
import type { Schedule } from './attendance-result-model.ts'

export const resolveSchedule = (_companyId: string, _employeeId: string, _workDate: string): Schedule | null => {
  // 固定回傳「沒有班表」，見檔頭。參數暫時用不到，保留簽章是為了讓呼叫端與未來的真實查詢一致，
  // 不必在排班模組上線時改呼叫端的傳參方式。
  return null
}
