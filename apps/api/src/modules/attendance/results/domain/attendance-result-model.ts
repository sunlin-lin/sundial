/**
 * 業務層型別（純型別，零執行期程式碼）。放在 `domain/` 而不是入口檔的理由與 `attendance/records/
 * domain/attendance-record-model.ts` 檔頭相同：§0 的檔名白名單沒有「模組共用型別」的位置，放進
 * 入口檔會讓 `impl/` 的切片回頭 import 入口檔，形成循環相依。
 */
import type { AttendanceResultStatusCodeValue, AttendanceTypeCodeValue } from '../../../../db/schema/index.ts'

export type { AttendanceResultStatusCodeValue } from '../../../../db/schema/index.ts'

/**
 * 判定引擎的輸入事件：當天「有效」（未撤銷）的一張打卡卡。
 *
 * **每種代碼至多一張**：`attendance_records` 的唯一鍵 `(employee_id, work_date,
 * attendance_type_code, revoked_seq)` 保證同一員工同一工作日同一類型只有一張有效卡，因此傳給
 * {@link computeAttendanceResult} 的事件陣列最多含一張上班卡與一張下班卡——不是「這個人今天打了
 * 幾次卡」的完整清單（那份清單，含已撤銷的歷史，屬於 §4.7「每日全員打卡明細」的查詢範圍，
 * 與這裡的判定引擎輸入是兩件事）。
 */
export type AttendanceResultEvent = {
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  /** 打卡時刻，`TaipeiDateTime`（`YYYY-MM-DD HH:mm:ss`，台北牆鐘，不含時區標記）。 */
  readonly clockedAt: string
}

/**
 * 對照班表判定所需的輸入。
 *
 * **這個型別目前只有一種真正的值：`null`。** `employee_schedules`（第 3 層排班）尚未實作，
 * 本階段（Stage 4）呼叫端（`domain/attendance-result-schedule.ts` 的 `resolveSchedule` 樁）
 * 永遠回傳 `null`，因此 {@link computeAttendanceResult} 目前只會走 `schedule === null` 那個分支
 * （見該檔）。
 *
 * **這個形狀是本計畫的推測，不是資料字典的定案**（實作計畫 `plans/06-attendance.md` §4.1 只定案了
 * 「無班表時寫什麼」，沒有定案「有班表時 `Schedule` 長什麼樣」——那件事排在第 3 層排班上線時才會
 * 有真正的資料來源可以參照）。第 3 層要做的是：從 `employee_schedules` 找出這個員工這個工作日
 * 適用的排班，再從 `shift_definitions`／`shift_work_periods`（`db/schema/shift-definitions.ts`／
 * `shift-work-periods.ts`，已於第 1 層完成）組出下面這個形狀——若屆時實際需要的欄位與這裡不同，
 * 允許直接調整這個型別定義，**唯一不能變的是：判定邏輯仍然只能寫在
 * `computeAttendanceResult` 這一個函式裡，不得為「有班表」另外寫一份計算器**（計畫 §4.1
 * 原文：兩份邏輯字面上不同、但語意上必須永遠一致，例如跨日班的 `work_date` 歸屬，維護成本會
 * 複製一份，而且分岔時不會有任何東西報錯）。
 */
export type Schedule = {
  /**
   * 這次判定應採用的應工作分鐘數。比照 `shift_definitions.required_work_minutes` 的既有慣例
   * （見該檔檔頭「為什麼要存而不是每次現算」）：存當時那一版班別算出來的值，不在判定當下重新
   * 計算，理由相同——規則改版不得覆蓋歷史。
   */
  readonly scheduledMinutes: number
  /**
   * 應上班／應下班時刻，`TaipeiDateTime`。**已經是換算過的具體日期時間**（依 `work_date` 與
   * 班別的日偏移 `end_day_offset` 換算完成），不是 `shift_work_periods` 那種不帶日期的 `time`
   * ——判定引擎比較的是兩個具體時間點的先後與差距，換算日期時間是第 3 層組出 `Schedule`
   * 時要做的事，不是判定引擎的職責。
   */
  readonly scheduledStart: string
  readonly scheduledEnd: string
}

export type AttendanceResultComputation = {
  readonly scheduledMinutes: number
  readonly workedMinutes: number
  readonly lateMinutes: number
  readonly earlyLeaveMinutes: number
  readonly absenceMinutes: number
  /** 核准請假分鐘數。第 4 層請假模組尚未實作，本階段固定 `0`（計畫 §8，不做提前猜測）。 */
  readonly leaveMinutes: number
  readonly overtimeMinutes: number
  readonly resultStatusCode: AttendanceResultStatusCodeValue
}

/** 重算單一員工單一工作日的輸入（供 `revoke`／`revoke-other` 編排進同一筆交易）。 */
export type RecalculateAttendanceResultInput = {
  readonly employeeId: string
  readonly workDate: string
}

/** 批次重算（「重算全部 `NO_SCHEDULE` 紀錄」）的輸出。 */
export type RecalculateAllNoScheduleResult = {
  readonly recalculatedCount: number
}
