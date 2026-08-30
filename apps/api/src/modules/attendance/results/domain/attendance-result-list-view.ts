/**
 * 「全體出勤」（`attendance/results/list`）與「我的出勤」（`attendance/results/list-own`）共用的
 * 組裝邏輯（零 IO 純函式，計畫 `plans/06-attendance.md` §5 Stage 7）。
 *
 * 計畫原文：「兩者都是『查 attendance_results 拿判定結果、查 attendance_records 拿時間地點來源』
 * 的複合查詢，讀取邏輯高度重疊……只是可以共用同一份 domain 組裝函式」——差別只在查詢範圍（公司
 * ／本人）與是否額外帶出員工姓名／工號／部門，因此把「一天的出勤事實怎麼組出來」抽成這裡的
 * {@link buildAttendanceResultListCore}，兩支 repository（`impl/attendance-results.list.
 * repository.ts`／`impl/attendance-results.list-own.repository.ts`）各自在外層疊加自己需要的
 * 員工／部門欄位。
 *
 * ## 狀態不是單一互斥值（UI 09／12 明文）
 *
 * `attendance_results.result_status_code` 目前只定義了 `NoSchedule` 一個代碼值（Stage 4 尚未
 * 實作對照班表判定，見 `attendance-result-model.ts` 的 `AttendanceResultStatusCode` 檔頭），但
 * UI 09 明文「同一天可能同時有遲到與早退，或同時有請假與出勤，因此狀態不得在 UI 假設為單一互斥
 * 值」。這裡不是把 `result_status_code` 原樣輸出，而是由「代碼」與「數值分鐘欄位」共同推導出一組
 * 獨立的狀態旗標（{@link deriveAttendanceResultStatuses}）：`NO_SCHEDULE` 來自代碼本身；
 * `LATE`／`EARLY_LEAVE`／`ABSENT`／`ON_LEAVE` 各自獨立由對應的 `*_minutes > 0` 推導，彼此不互斥，
 * 可以同時出現在同一列。
 *
 * 現階段（Stage 4 無班表判定）遲到／早退／缺勤／請假分鐘數恆為 `0`（計畫 §4.1、§8），因此實際
 * 輸出永遠只有 `['NO_SCHEDULE']` 一種組合——但排班（第 3 層）與請假（第 4 層）上線後，這幾個
 * 分鐘數開始出現非零值時，這裡不需要任何修改就會自然吐出多個狀態同時存在，這正是「由數值欄位
 * 推導，不是只看那一個代碼欄位」的意義：狀態的組合规则已經在這裡，不必等下游模組上線才回頭設計。
 */
import { AttendanceResultStatusCode } from '../../../../db/schema/index.ts'
import type { AttendanceResultStatusCodeValue, AttendanceSourceTypeCodeValue } from '../../../../db/schema/index.ts'

/** 狀態旗標。同一列可以同時出現多個，見檔頭。 */
export const AttendanceResultStatusFlag = {
  NoSchedule: 'NO_SCHEDULE',
  Late: 'LATE',
  EarlyLeave: 'EARLY_LEAVE',
  Absent: 'ABSENT',
  OnLeave: 'ON_LEAVE',
} as const

export type AttendanceResultStatusFlagValue =
  (typeof AttendanceResultStatusFlag)[keyof typeof AttendanceResultStatusFlag]

/** 狀態旗標推導的輸入：判定引擎寫入的代碼＋數值欄位，缺一不可（見檔頭）。 */
export type AttendanceResultStatusInput = {
  readonly resultStatusCode: AttendanceResultStatusCodeValue
  readonly lateMinutes: number
  readonly earlyLeaveMinutes: number
  readonly absenceMinutes: number
  readonly leaveMinutes: number
}

/** 由代碼＋數值欄位推導一組狀態旗標，可同時含多個（見檔頭）。 */
export const deriveAttendanceResultStatuses = (
  input: AttendanceResultStatusInput,
): readonly AttendanceResultStatusFlagValue[] => {
  const statuses: AttendanceResultStatusFlagValue[] = []
  if (input.resultStatusCode === AttendanceResultStatusCode.NoSchedule) {
    statuses.push(AttendanceResultStatusFlag.NoSchedule)
  }
  if (input.lateMinutes > 0) statuses.push(AttendanceResultStatusFlag.Late)
  if (input.earlyLeaveMinutes > 0) statuses.push(AttendanceResultStatusFlag.EarlyLeave)
  if (input.absenceMinutes > 0) statuses.push(AttendanceResultStatusFlag.Absent)
  if (input.leaveMinutes > 0) statuses.push(AttendanceResultStatusFlag.OnLeave)
  return statuses
}

/** 判定引擎輸出的一天結果，供組裝共用核心使用。 */
export type AttendanceResultDayRow = AttendanceResultStatusInput & {
  readonly id: string
  readonly workDate: string
  readonly workedMinutes: number
}

/**
 * 當天一張有效打卡卡（上班或下班）。`null` 表示這天沒有這一種卡——查不到不是錯誤，`NO_SCHEDULE`
 * 的判定本來就可能只配對到其中一張，或兩張都沒有（計畫 §4.1）。
 */
export type AttendanceResultClockEvent = {
  readonly clockedAt: string
  readonly address: string | null
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue
} | null

/**
 * 共用組裝核心：一天的出勤事實，不含員工／部門這類「查的是誰」才需要的欄位——那些由呼叫端
 * （`list.repository.ts`／`list-own.repository.ts`）各自疊加，見檔頭。
 */
export type AttendanceResultListCore = {
  readonly id: string
  readonly workDate: string
  readonly clockInAt: string | null
  readonly clockInAddress: string | null
  readonly clockOutAt: string | null
  readonly clockOutAddress: string | null
  readonly workedMinutes: number
  readonly lateMinutes: number
  readonly earlyLeaveMinutes: number
  readonly absenceMinutes: number
  /** 這一天的打卡來源。優先取上班卡，上班卡不存在才退回下班卡——兩者理論上出自同一次任職的
   * 同一種來源（現場打卡或人工補登），沒有必要同時顯示兩個來源。兩張卡都不存在時為 `null`
   * （理論上不會發生：判定結果的重算永遠由打卡建立或撤銷觸發，但寫成不可能發生的假設本身就是
   * 一種脆弱，這裡誠實回傳 `null` 而不是假設「一定有一張」）。 */
  readonly sourceTypeCode: AttendanceSourceTypeCodeValue | null
  readonly statuses: readonly AttendanceResultStatusFlagValue[]
}

/**
 * 由查詢出來的三個可能為 `null` 的欄位組出一個 {@link AttendanceResultClockEvent}。**兩個欄位
 * 都非 `null` 才視為「有這張卡」**，不是只檢查 `clockedAt`——`clockedAt` 與 `sourceTypeCode` 來自
 * 同一個 `LEFT JOIN` 別名的同一列，正常情況下要嘛同時有值、要嘛同時是 `null`；用雙重檢查取代
 * `sourceTypeCode!`（型別斷言），因為 ESLint 的 `no-non-null-assertion` 規則禁止斷言，這裡改用
 * 一個明確的條件表達「兩者必須一起出現」，比斷言更能承受未來欄位增減時的型別檢查。
 */
export const toAttendanceResultClockEvent = (
  clockedAt: string | null,
  address: string | null,
  sourceTypeCode: AttendanceSourceTypeCodeValue | null,
): AttendanceResultClockEvent =>
  clockedAt === null || sourceTypeCode === null ? null : { clockedAt, address, sourceTypeCode }

export const buildAttendanceResultListCore = (
  result: AttendanceResultDayRow,
  clockIn: AttendanceResultClockEvent,
  clockOut: AttendanceResultClockEvent,
): AttendanceResultListCore => ({
  id: result.id,
  workDate: result.workDate,
  clockInAt: clockIn?.clockedAt ?? null,
  clockInAddress: clockIn?.address ?? null,
  clockOutAt: clockOut?.clockedAt ?? null,
  clockOutAddress: clockOut?.address ?? null,
  workedMinutes: result.workedMinutes,
  lateMinutes: result.lateMinutes,
  earlyLeaveMinutes: result.earlyLeaveMinutes,
  absenceMinutes: result.absenceMinutes,
  sourceTypeCode: clockIn?.sourceTypeCode ?? clockOut?.sourceTypeCode ?? null,
  statuses: deriveAttendanceResultStatuses(result),
})

/** `list`（全體出勤，公司範圍）的查詢條件。年月＋部門＋人員篩選（UI 09）。 */
export type ListAttendanceResultsQuery = {
  readonly yearMonth: string
  readonly departmentId: string | null
  readonly employeeId: string | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: { readonly field: 'workDate' | 'employeeCode'; readonly order: 'asc' | 'desc' }
}

/** `list` 單筆：共用核心＋員工與「該日有效部門」（計畫 §5 Stage 7、UI 09「部門篩選與顯示應依
 * 查詢日期對應的有效部門資料」）。 */
export type AttendanceResultListItem = AttendanceResultListCore & {
  readonly employeeId: string
  readonly employeeCode: string
  readonly employeeName: string
  readonly departmentName: string | null
}

export type ListAttendanceResultsPage = {
  readonly items: readonly AttendanceResultListItem[]
  readonly totalCount: number
}

/** `list-own`（我的出勤，本人範圍）的查詢條件。**不含 `employeeId`／`departmentId`**——範圍固定為
 * token 推出的呼叫者本人，不需要、也不接受篩選是哪個員工或部門（計畫「body 不得接受 employeeId」，
 * 比照 `attendance/records` 的 `list-own-by-date`）。 */
export type ListOwnAttendanceResultsQuery = {
  readonly yearMonth: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort: { readonly field: 'workDate'; readonly order: 'asc' | 'desc' }
}

/** `list-own` 單筆：僅共用核心，不含員工／部門欄位——查的必然是自己，見 `attendance/records` 的
 * `OwnAttendanceRecordListItem` 同一條先例。 */
export type OwnAttendanceResultListItem = AttendanceResultListCore

export type ListOwnAttendanceResultsPage = {
  readonly items: readonly OwnAttendanceResultListItem[]
  readonly totalCount: number
}
