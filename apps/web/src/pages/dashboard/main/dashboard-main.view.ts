/**
 * 「今日打卡」狀態的推導與顯示（前端規範 §1.3 的第 (1)(2) 類，UI 定案 10）。
 *
 * ## 狀態怎麼判斷
 *
 * 三種狀態（尚未上班／上班中／已下班）完全由「今天這個人手上有沒有一張有效的上班卡／下班卡」
 * 推導。**狀態在頁面載入時就從 `attendanceRecordsListOwnByDate`（計畫 06 Stage 5 缺口二）查出來**
 * ——{@link deriveTodayPunchesFromOwnList} 是這一步的純函式；使用者在本次瀏覽中打卡或撤銷時，
 * `AttendanceTodayCard.vue` 再用 `attendanceRecordsCreate`／`attendanceRecordsRevoke` 的回應
 * 就地更新，不必整包重打一次查詢。
 *
 * **這裡曾經有一個已知限制，現在已經解決**：重新整理頁面過去會讓狀態歸零、回到「尚未上班」，
 * 即使今天稍早已經打過卡——原因是當時沒有任何一支端點能查「本人今天打過什麼卡」。
 * `attendance/records/list-own-by-date` 補上這個缺口後，`.page.vue` 在 `onMounted` 就先查一次
 * 今天的紀錄，狀態不再依賴本次瀏覽階段的累積。
 */
import { formatDateTime } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type {
  AttendanceRecordsCreateData,
  AttendanceRecordsListOwnByDateData,
} from '../../../api/generated/api-client.ts'
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 打卡明細。`create`／`revoke` 的回應形狀逐欄相同（後端共用同一個 `AttendanceRecordDetailSchema`），
 * 因此兩支呼叫的回應都可以直接當這個型別用，不必另外宣告一份。 */
export type AttendanceRecordDetail = AttendanceRecordsCreateData

/** `list-own-by-date` 回應單筆的形狀（由產生型別推導，§3.2）。 */
type OwnAttendanceRecordListItem = AttendanceRecordsListOwnByDateData['data'][number]

/** 打卡類型代碼。值必須與後端 `db/schema/attendance-records.ts` 的 `AttendanceTypeCode` 相同。 */
export const ATTENDANCE_TYPE_CLOCK_IN = 1
export const ATTENDANCE_TYPE_CLOCK_OUT = 2

export type TodayAttendanceStatus = 'not-started' | 'clocked-in' | 'clocked-out'

/**
 * 「今天這張卡」這張卡片實際用得到的欄位——只有 `id`（撤銷要用）與 `clockedAt`（顯示要用）。
 *
 * **刻意不是 {@link AttendanceRecordDetail}**：`list-own-by-date` 回應單筆
 * （{@link OwnAttendanceRecordListItem}）沒有 `latitude`／`longitude`／`accuracyMeters`／
 * `employeeId`／`createdAt`／`updatedAt` 這幾欄（計畫 §4.2：列表一律不回座標；本人查詢範圍固定，
 * 不需要重複回聲自己的識別欄位），收窄成只列「這張卡片真的會讀」的欄位，`create`／`revoke` 的
 * 完整回應與 `list-own-by-date` 的列表項目才能**兩者都直接指派過來**，不必為了湊同一個型別
 * 而互相補欄位。
 */
export type TodayPunchRecord = {
  readonly id: string
  readonly clockedAt: string
}

/** 「今天」手上有哪兩張卡（都可能是 `null`）。 */
export type TodayPunches = {
  readonly clockIn: TodayPunchRecord | null
  readonly clockOut: TodayPunchRecord | null
}

export const emptyTodayPunches = (): TodayPunches => ({ clockIn: null, clockOut: null })

/**
 * 由 `attendanceRecordsListOwnByDate` 的回應推導今天手上有哪兩張卡。
 *
 * **含已撤銷紀錄的回應，必須先濾掉才能推導**（端點本身的回報：`revokedAt` 非 `null` 代表
 * 這筆已經不算數，任務規則明講「推導狀態時要濾掉已撤銷的」）。過濾之後，唯一鍵
 * `UNIQUE(employee_id, work_date, attendance_type_code, revoked_seq)` 保證同一天同一種卡
 * 最多只剩一筆有效紀錄，因此 `find` 不需要再處理「找到兩筆怎麼辦」。
 */
export const deriveTodayPunchesFromOwnList = (items: readonly OwnAttendanceRecordListItem[]): TodayPunches => {
  const validItems = items.filter((item) => item.revokedAt === null)
  const clockIn = validItems.find((item) => item.attendanceTypeCode === ATTENDANCE_TYPE_CLOCK_IN) ?? null
  const clockOut = validItems.find((item) => item.attendanceTypeCode === ATTENDANCE_TYPE_CLOCK_OUT) ?? null
  return { clockIn, clockOut }
}

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
 * （見該檔檔頭），不在這裡另外重寫一次判斷。
 *
 * 參數只要求 `clockedAt` 一欄（{@link TodayPunchRecord} 與 {@link AttendanceRecordDetail} 都滿足），
 * 呼叫端不論手上是 `list-own-by-date` 的列表項目還是 `create`／`revoke` 的完整明細都能直接傳進來。 */
export const clockTimeDisplay = (record: { readonly clockedAt: string } | null): string => {
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
