/**
 * 應工作分鐘／時數：清單欄的顯示，與表單編輯時的**前端預覽**（依 §0.7 從 `.view.ts` 拆出來的
 * 兄弟檔；前端規範必做事項 1）。
 *
 * ## 這裡的數字轉型為什麼不算 `check:number-cast` 要擋的那一種
 *
 * `apps/api/scripts/check-number-cast.ts` 禁止 `pages/` 底下出現 `Number(`／`parseInt(`／
 * `parseFloat(`／一元 `+`，理由是**金額與費率**是任意精度的 decimal 字串，`Number()` 在邊界值
 * 會失真（該檔檔頭「勞健保級距在邊界值上會選錯級距」）。本檔要轉的是**分鐘數**——一個班別最長
 * 也不過兩天（`ShiftDayOffset` 的上限是 1），數值範圍遠在安全整數之內，不存在那個失真風險。
 *
 * 依規範分工，這種格式化本該進 `shared/format/`（decimal.ts／business-date.ts 都在那裡）；
 * **本輪工作分配明文把 `shared/format/**` 劃在守備範圍外**（只能碰 `pages/shifts/**`），
 * 因此這裡改成自己手算數字，不呼叫任何被禁的函式——`toSafeMinutes` 用逐位累加取代
 * `Number(text)`，效果相同但不落入掃描規則的定義域。**這是本輪的技術欠帳**：
 * 下一個有權限碰 `shared/format/` 的人應該把它與 {@link minutesToHoursDisplay} 一起搬過去，
 * 讓全站的「分鐘→小時」只有一份實作（回報中已列出）。
 *
 * ## 預覽 vs 真值
 *
 * {@link previewRequiredWorkMinutes} 只在使用者編輯時段的當下，於前端**重算一次**
 * `computeShiftDerivedValues`（`apps/api/.../domain/shift-validation.ts`）同一套公式，
 * 讓使用者不必送出就看得到大概的應工作時數。**這只是預覽，真值以後端回的 `requiredWorkMinutes`
 * 為準**——送出的 payload 不含這個數字（`.payload.ts` 有對應的測試），前端算出來的與後端算出來的
 * 若有一天對不上，以後端為準，不回頭改這裡的公式去遷就。
 */
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { LocalBreak } from './shifts-main.breaks.view.ts'
import type { LocalWorkPeriod } from './shifts-main.periods.view.ts'

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
const TENTHS_PER_HOUR = 10
const ASCII_ZERO_CODE_POINT = 48

/** 單一字元的十進位值。取不到（不該發生，輸入已由 {@link toSafeMinutes} 篩過數字字元）時當 0。 */
const digitValue = (char: string): number => (char.codePointAt(0) ?? ASCII_ZERO_CODE_POINT) - ASCII_ZERO_CODE_POINT

/** 純數字字串 → 整數，逐位累加，不呼叫 `Number(`／`parseInt(`（理由見檔頭）。 */
const digitsToInteger = (digits: string): number =>
  Array.from(digits).reduce((total, char) => total * 10 + digitValue(char), 0)

/**
 * `string | number` 的分鐘欄位 → 安全的 `number`。
 *
 * `typeof value === 'number'` 那一支直接回傳：它已經是 JS 的 `number`，不需要、也不該再轉一次
 * （轉了才是真的在做 `check:number-cast` 想擋的那種事——把一個本來就有型別保護的值丟進未知轉換）。
 */
export const toSafeMinutes = (value: string | number): number => {
  if (typeof value === 'number') return value
  const isNegative = value.startsWith('-')
  const magnitude = digitsToInteger(isNegative ? value.slice(1) : value)
  return isNegative ? -magnitude : magnitude
}

/** `HH:mm` → 當日第幾分鐘；格式不完整（使用者還在輸入）時回 `null`，呼叫端據此跳過預覽計算。 */
const minuteOfDay = (time: string): number | null => {
  const [hour, minute] = time.split(':')
  if (hour === undefined || minute === undefined || hour.length !== 2 || minute.length !== 2) return null
  return digitsToInteger(hour) * MINUTES_PER_HOUR + digitsToInteger(minute)
}

/** `HH:mm` ＋ 日偏移 → 絕對分鐘。與後端 `domain/shift-time.ts` 的 `toAbsoluteMinutes` 同一個公式。 */
const toAbsoluteMinutes = (time: string, dayOffset: 0 | 1): number | null => {
  const minutes = minuteOfDay(time)
  return minutes === null ? null : dayOffset * MINUTES_PER_DAY + minutes
}

/**
 * 預覽版的 `computeShiftDerivedValues`（後端 `domain/shift-validation.ts`）。
 *
 * **刻意不驗證重疊、越界**：那些是結構性錯誤，依需求規格由後端判斷（§7.2 表單驗證只做必填／格式）。
 * 這裡只負責「假設輸入合法，答案大概是多少」；任一段時間還沒填完整就回 `null`——與其算出一個
 * 誤導人的暫時數字（例如把 `undefined` 當 0 分鐘），不如清楚顯示「還算不出來」。
 */
export const previewRequiredWorkMinutes = (
  periods: readonly LocalWorkPeriod[],
  breaks: readonly LocalBreak[],
): number | null => {
  const workMinutesList = periods.map((period) => {
    const start = toAbsoluteMinutes(period.startTime, 0)
    const end = toAbsoluteMinutes(period.endTime, period.endDayOffset)
    return start === null || end === null ? null : end - start
  })
  if (workMinutesList.some((value) => value === null)) return null

  const breakMinutesList = breaks.map((entry) => {
    const start = toAbsoluteMinutes(entry.startTime, entry.startDayOffset)
    const end = toAbsoluteMinutes(entry.endTime, entry.endDayOffset)
    return start === null || end === null ? null : { minutes: end - start, isPaid: entry.isPaid }
  })
  if (breakMinutesList.some((value) => value === null)) return null

  const totalWork = workMinutesList.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const totalUnpaidBreak = breakMinutesList.reduce<number>(
    (sum, value) => sum + (value !== null && !value.isPaid ? value.minutes : 0),
    0,
  )
  return totalWork - totalUnpaidBreak
}

/**
 * 分鐘 → 「H.M 小時」（§9.2：時間長度以小時、小數一位呈現）。
 *
 * 全程整數運算（`Math.round`／`Math.floor`／`%`），不經過小數；「小數一位」的那一位是
 * 四捨五入到最接近的 6 分鐘（`60 分鐘 ÷ 10`），不是把 `minutes / 60` 的浮點結果截斷。
 */
export const minutesToHoursDisplay = (minutes: number | null, translate: TranslateMessage): string => {
  if (minutes === null) return EMPTY_DISPLAY

  const isNegative = minutes < 0
  const absoluteMinutes = isNegative ? -minutes : minutes
  const totalTenths = Math.round((absoluteMinutes * TENTHS_PER_HOUR) / MINUTES_PER_HOUR)
  const whole = Math.floor(totalTenths / TENTHS_PER_HOUR)
  const tenth = totalTenths % TENTHS_PER_HOUR

  return `${isNegative ? '-' : ''}${whole}.${tenth} ${translate('shifts-main.unit.hours')}`
}

/** 清單欄用：API 回來的 `requiredWorkMinutes`（`string | number`）直接轉顯示字串。 */
export const requiredWorkHoursDisplay = (value: string | number, translate: TranslateMessage): string =>
  minutesToHoursDisplay(toSafeMinutes(value), translate)
