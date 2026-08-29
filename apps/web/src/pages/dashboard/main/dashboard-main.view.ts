/**
 * 「今日打卡」狀態的推導與顯示（前端規範 §1.3 的第 (1)(2) 類，UI 定案 10）。
 *
 * ## 狀態怎麼判斷——以及這裡的已知限制
 *
 * 三種狀態（尚未上班／上班中／已下班）完全由「今天這個人手上有沒有一張有效的上班卡／下班卡」
 * 推導，資料來源是 `attendanceRecordsCreate`／`attendanceRecordsRevoke` 呼叫的回應本身——
 * **後端 Stage 3／4 沒有提供任何「查詢本人今天打卡記錄」的端點**（`attendance/records/get` 要
 * 已知 `recordId`；`list-by-date` 的權限碼 `attendance.records.list-by-date` 是 Stage 6「每日
 * 全員打卡明細」的查看權限，性質是人事／主管查全公司當天紀錄，不是每個員工都會有的一般權限，
 * 拿來當「我自己今天打了什麼卡」的查詢會把 Dashboard 綁在一個不保證存在的權限上）。
 *
 * 因此本頁的狀態只在**本次瀏覽階段**（同一個分頁、未重新整理）內可靠：使用者在這次瀏覽中打卡
 * 或撤銷，狀態會正確反映；但重新整理頁面後，`.page.vue` 的狀態歸零，畫面會回到「尚未上班」，
 * 即使他今天稍早已經打過上班卡。這不是這裡的判斷寫錯，而是沒有對應的查詢端點可用——
 * 已在回報中列為後端缺口，不是本檔要掩蓋或假裝解決的事。
 */
import { formatDateTime } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { AttendanceRecordsCreateData } from '../../../api/generated/api-client.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 打卡明細。`create`／`revoke` 的回應形狀逐欄相同（後端共用同一個 `AttendanceRecordDetailSchema`），
 * 因此兩支呼叫的回應都可以直接當這個型別用，不必另外宣告一份。 */
export type AttendanceRecordDetail = AttendanceRecordsCreateData

/** 打卡類型代碼。值必須與後端 `db/schema/attendance-records.ts` 的 `AttendanceTypeCode` 相同。 */
export const ATTENDANCE_TYPE_CLOCK_IN = 1
export const ATTENDANCE_TYPE_CLOCK_OUT = 2

export type TodayAttendanceStatus = 'not-started' | 'clocked-in' | 'clocked-out'

/** 「今天」手上有哪兩張卡（都可能是 `null`）。見檔頭：這是本次瀏覽階段內累積的結果，不是查詢結果。 */
export type TodayPunches = {
  readonly clockIn: AttendanceRecordDetail | null
  readonly clockOut: AttendanceRecordDetail | null
}

export const emptyTodayPunches = (): TodayPunches => ({ clockIn: null, clockOut: null })

/**
 * 狀態推導：有下班卡就是已下班，否則有上班卡就是上班中，兩者都沒有就是尚未上班。
 * 沒有第四種分支——UI 定案 10 只定義這三種，「沒有有效上班卡時不得先打下班卡」由後端擋
 * （`attendance.records.errors.no-clock-in-to-pair`），這裡不需要重複判斷一次。
 */
export const deriveTodayStatus = (punches: TodayPunches): TodayAttendanceStatus => {
  if (punches.clockOut !== null) return 'clocked-out'
  if (punches.clockIn !== null) return 'clocked-in'
  return 'not-started'
}

const STATUS_LABEL_KEYS = {
  'not-started': 'dashboard.attendance.status.not-started',
  'clocked-in': 'dashboard.attendance.status.clocked-in',
  'clocked-out': 'dashboard.attendance.status.clocked-out',
} as const satisfies Record<TodayAttendanceStatus, MessageKey>

export const todayStatusLabel = (status: TodayAttendanceStatus, translate: TranslateMessage): string =>
  translate(STATUS_LABEL_KEYS[status])

/** 打卡時刻只顯示「時:分」——列表不顯示座標，這一頁同樣不顯示（計畫 §4.2、任務範圍明講）。
 * 借用 `formatDateTime` 裁到分鐘再取最後 5 碼，理由是重用它已經做過的 null／時區標記防呆
 * （見該檔檔頭），不在這裡另外重寫一次判斷。 */
export const clockTimeDisplay = (record: AttendanceRecordDetail | null): string => {
  if (record === null) return EMPTY_DISPLAY
  const dateTime = formatDateTime(record.clockedAt)
  return dateTime.length < 5 ? EMPTY_DISPLAY : dateTime.slice(-5)
}

/** 逐位累加，不呼叫 `Number(`／`parseInt(`（`check:number-cast` 禁止；作法與 `shifts-main.duration.
 * view.ts` 的 `digitsToInteger` 相同，這裡的值同樣是小範圍的時分秒，不重複那一份較長的說明）。 */
const digitValue = (char: string): number => (char.codePointAt(0) ?? 48) - 48
const digitsToInteger = (digits: string): number =>
  Array.from(digits).reduce((total, char) => total * 10 + digitValue(char), 0)

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

/** `YYYY-MM-DD HH:mm:ss`（業務時間字串，無時區標記）→ 當日第幾秒；格式不符時回 `null`。 */
const secondsSinceMidnight = (value: string): number | null => {
  const timePart = value.slice(11)
  if (timePart.length !== 8) return null
  const hour = timePart.slice(0, 2)
  const minute = timePart.slice(3, 5)
  const second = timePart.slice(6, 8)
  return (
    digitsToInteger(hour) * SECONDS_PER_HOUR + digitsToInteger(minute) * SECONDS_PER_MINUTE + digitsToInteger(second)
  )
}

/**
 * 今日工時（分鐘），純粹給 Dashboard 頭部一個大概的數字看。**不是權威值**：真正的工時判定在
 * `attendance_results`（Stage 4 的判定引擎），這一頁沒有查詢它的端點（同檔頭的限制），這裡只是
 * 拿兩個時刻相減，跨日的情況（下班卡配對到前一天）用「加一天」的方式粗略處理，不精確但不誤導
 * ——結果只用於「工時 X.X 小時」這一句話，不會被用在任何金額或法定判斷上。
 */
export const workedMinutes = (punches: TodayPunches): number | null => {
  if (punches.clockIn === null || punches.clockOut === null) return null
  const start = secondsSinceMidnight(punches.clockIn.clockedAt)
  const end = secondsSinceMidnight(punches.clockOut.clockedAt)
  if (start === null || end === null) return null
  const diffSeconds = end >= start ? end - start : end - start + SECONDS_PER_DAY
  return Math.floor(diffSeconds / SECONDS_PER_MINUTE)
}

const MINUTES_PER_HOUR = 60
const TENTHS_PER_HOUR = 10

/** 分鐘 → 「H.M 小時」，全程整數運算，同 `shifts-main.duration.view.ts` 的 `minutesToHoursDisplay`。 */
export const workedHoursDisplay = (minutes: number | null, translate: TranslateMessage): string => {
  if (minutes === null) return EMPTY_DISPLAY
  const totalTenths = Math.round((minutes * TENTHS_PER_HOUR) / MINUTES_PER_HOUR)
  const whole = Math.floor(totalTenths / TENTHS_PER_HOUR)
  const tenth = totalTenths % TENTHS_PER_HOUR
  return `${whole}.${tenth} ${translate('dashboard.attendance.unit.hours')}`
}
