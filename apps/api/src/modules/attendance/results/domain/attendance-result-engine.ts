/**
 * 判定引擎（零 IO 純函式）：實作計畫 `plans/06-attendance.md` §4.1 定案的固定簽章
 * `computeAttendanceResult(events, schedule: Schedule | null)`。
 *
 * **排班（第 3 層）上線時，要做的是把真正的 `Schedule` 物件傳進這個函式，不是另外寫一份
 * 「有班表版」的計算器。** 兩份邏輯字面上不同、但語意上必須永遠一致（例如跨日班的
 * `work_date` 歸屬這條規則），維護成本會複製一份，而且分岔時不會有任何東西報錯——這是計畫
 * §4.1 的原文判斷，這個檔案的存在就是要讓那句話在程式碼上成立：不論呼叫端是 Stage 4 的
 * `resolveSchedule` 樁（永遠回 `null`）還是第 3 層真正查出來的班表，都只有這一個函式在算。
 */
import { AttendanceResultStatusCode, AttendanceTypeCode } from '../../../../db/schema/index.ts'
import type { AttendanceResultComputation, AttendanceResultEvent, Schedule } from './attendance-result-model.ts'

const TAIPEI_UTC_OFFSET_MINUTES = 8 * 60
const MINUTES_PER_HOUR = 60
const MILLISECONDS_PER_MINUTE = 60 * 1000

/**
 * 把 `TaipeiDateTime`（`'YYYY-MM-DD HH:mm:ss'`，台北牆鐘，不含時區標記）換算成絕對時間的毫秒數。
 *
 * **不用 `new Date(value.replace(' ', 'T'))`**：那個字串沒有時區標記，JS 引擎會依「執行環境的
 * 本地時區」解讀——伺服器的本地時區不保證是台北（多半是 UTC，見 `db/client.ts` 連線設定的
 * 註解）。這裡改用 `Date.UTC` 手動組出 UTC 毫秒後再減去固定的台北偏移，結果與執行環境的時區
 * 設定無關。
 *
 * **這不是 §6.2 禁止的「讀現在」**：這裡把一個已知、固定的字串轉成毫秒數，不是在問「現在幾點」，
 * 因此不觸犯 ESLint 對 `new Date()`（零參數）／`Date.now()` 的限制——`Date.UTC(...)` 是完全
 * 不同的 AST 節點（靜態方法呼叫），那條規則的兩個 selector 都比對不到它（見 `eslint.config.js`
 * 該條規則的註解）。
 */
const parseTaipeiDateTimeToUtcMs = (value: string): number => {
  const [datePart = '', timePart = ''] = value.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second] = timePart.split(':').map(Number)
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    [year, month, day, hour, minute, second].some(Number.isNaN)
  ) {
    // 走到這裡代表 `clocked_at` 不是預期的 TaipeiDateTime 格式——這一欄只會由本系統自己寫入
    // （§6.1），格式錯誤代表資料損毀或程式假設被打破，屬系統錯誤（§3.1.2），不是可以吞掉、
    // 靜靜算出 NaN 工作分鐘的業務分支。
    throw new Error(`打卡時刻不是預期的 TaipeiDateTime 格式：${value}`)
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - TAIPEI_UTC_OFFSET_MINUTES * MINUTES_PER_HOUR * 1000
}

/**
 * `worked_minutes`：配對到的有效上班卡與下班卡時間差（計畫 §4.1，唯一在無班表時仍算得出來的
 * 欄位）。
 *
 * **`events` 至多含一張上班卡與一張下班卡**，見 `attendance-result-model.ts` 的
 * {@link AttendanceResultEvent} 檔頭；不是「多次進出」的清單。任一張缺席時回 `0`
 * ——沒有完整的一組卡，算不出工作時間。
 *
 * 下班卡早於或等於上班卡（人工補登誤植等資料異常）時同樣回 `0`，不回負值：負的工作分鐘沒有
 * 業務意義，這種情況之後應該由判定狀態去標記（排班上線後的異常判定，計畫 §8 明列排在本階段
 * 之外），不是讓一個負數悄悄流進彙總。
 */
const computeWorkedMinutes = (events: readonly AttendanceResultEvent[]): number => {
  const clockIn = events.find((event) => event.attendanceTypeCode === AttendanceTypeCode.ClockIn)
  const clockOut = events.find((event) => event.attendanceTypeCode === AttendanceTypeCode.ClockOut)
  if (clockIn === undefined || clockOut === undefined) return 0

  const minutes = Math.floor(
    (parseTaipeiDateTimeToUtcMs(clockOut.clockedAt) - parseTaipeiDateTimeToUtcMs(clockIn.clockedAt)) /
      MILLISECONDS_PER_MINUTE,
  )
  return minutes > 0 ? minutes : 0
}

/**
 * 判定引擎。
 *
 * `schedule` 為 `null` 時（本階段唯一會發生的情況，見 `attendance-result-schedule.ts` 的
 * `resolveSchedule` 樁）跳過遲到／早退／應工時／缺勤分支，只算 `worked_minutes`，回傳
 * `NO_SCHEDULE`；`scheduled_minutes`／`late_minutes`／`early_leave_minutes`／
 * `overtime_minutes`／`absence_minutes` 全部是必填 integer、沒有 nullable 退路，因此一律寫
 * `0`（計畫 §4.1，不得冒用「正常」代碼——這正是這條規則存在的理由）。
 */
export const computeAttendanceResult = (
  events: readonly AttendanceResultEvent[],
  schedule: Schedule | null,
): AttendanceResultComputation => {
  const workedMinutes = computeWorkedMinutes(events)

  if (schedule === null) {
    return {
      scheduledMinutes: 0,
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      absenceMinutes: 0,
      // 請假扣抵出勤：第 4 層請假模組尚未實作，本階段固定 0，不做提前猜測（計畫 §8）。
      leaveMinutes: 0,
      overtimeMinutes: 0,
      resultStatusCode: AttendanceResultStatusCode.NoSchedule,
    }
  }

  // 第 3 層排班上線時，在這裡加上對照班表的遲到／早退／應工時／缺勤判定分支——不是另外寫一個
  // 函式（檔頭）。本階段（Stage 4）沒有任何呼叫路徑會傳非 null 的 schedule：`resolveSchedule`
  // 固定回傳 `null`。這裡刻意丟出例外而不是靜靜回傳猜測值——算錯的出勤判定比明確中止更難發現，
  // 且會被拿去彙總進薪資／加班等下游計算。
  throw new Error('對照班表的出勤判定尚未實作（計畫 §8：排在排班上線之後）')
}
