/**
 * 時間換算（零 IO 純函式）。
 *
 * 班別的時刻一律以「當日第幾分鐘」搭配日偏移換算成**絕對分鐘**再比較，理由是後端規範 §6.2 的
 * 最後一句：「用 `HH:mm` 字串比大小，跨午夜時段的結束時刻會小於開始時刻，時長算成負數。」
 * `shift_work_periods.end_day_offset` 與 `shift_breaks` 的兩個日偏移欄位（計畫 §4.2）就是為了
 * 讓這個換算算得出來——22:00–06:00(+1) 換成絕對分鐘是 1320 → 1800，差 480，而不是負的。
 *
 * API 對外一律 `HH:mm`（後端規範 §6.1「不含日期的時刻」），資料庫的 `time` 欄位存的是
 * `HH:mm:ss`（drizzle 的 `time()` 型態，見 `db/schema/shift-work-periods.ts`）。
 * 本檔同時負責這兩種格式之間的轉換，讓格式差異只在這一處被處理。
 */

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

/** `HH:mm` 的樣式，與路由層 `ShiftClockTime` schema 的 pattern 一致（那邊已經驗過一次格式）。 */
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * `HH:mm` → 當日第幾分鐘（0–1439）。
 *
 * @throws 格式不符時拋出。這是系統錯誤（§3.1.2）：路由層的 schema 已經擋過一次格式，
 *   走到這裡代表呼叫端與 schema 之間有東西不一致，不是使用者送錯資料。
 */
export const minuteOfDay = (time: string): number => {
  const match = HH_MM_PATTERN.exec(time)
  if (match === null) {
    throw new Error(`時刻格式不是 HH:mm：${time}（應已由路由層的 schema 擋下，這裡不該走到）`)
  }
  const hourText = match[1]
  const minuteText = match[2]
  if (hourText === undefined || minuteText === undefined) {
    throw new Error(`時刻格式不是 HH:mm：${time}`)
  }
  return Number(hourText) * MINUTES_PER_HOUR + Number(minuteText)
}

/** `HH:mm` ＋ 日偏移 → 絕對分鐘（可能為負或超過 1440，這正是跨日比較需要的形狀）。 */
export const toAbsoluteMinutes = (time: string, dayOffset: number): number =>
  dayOffset * MINUTES_PER_DAY + minuteOfDay(time)

/** API 的 `HH:mm` → DB 的 `HH:mm:ss`。寫入前呼叫，秒數固定補 `:00`——本系統的時刻輸入沒有秒。 */
export const toDbTime = (time: string): string => `${time}:00`

/**
 * DB 的 `HH:mm:ss`（或任何驅動可能回傳的更長格式）→ API 的 `HH:mm`。
 *
 * 只取前 5 碼：mysql2 對 `TIME` 欄位固定回傳 `HH:MM:SS` 字串（不含微秒，因為 schema 沒有指定
 * `fsp`），因此前 5 碼就是 `HH:mm`，不需要再解析後重新格式化。
 */
export const fromDbTime = (dbTime: string): string => dbTime.slice(0, 5)
