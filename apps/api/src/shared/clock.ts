/**
 * 可注入的「現在」（§6.2）。
 *
 * **業務程式碼禁止直接 `new Date()`／`Date.now()`**，一律由呼叫端把 clock 傳進來。
 * 底層自己抓時間的話，跨日、月底、閏年、到期日這類邏輯根本無法測試——你不能為了跑一條測試
 * 把機器時間調到 2 月 29 日，於是這類 bug 只會在真正的月底當天出現在正式環境。
 *
 * 本檔是全專案唯一允許讀取系統時間的地方。
 */

/** 營運時區。禁止在各處寫死字串或依賴伺服器時區（伺服器多半跑在 UTC）。 */
export const TAIPEI_TIME_ZONE = 'Asia/Taipei'

/**
 * 台北的 UTC 偏移。台灣自 1980 年起未再實施日光節約時間，因此這是常數而非查表結果；
 * 若未來恢復日光節約，這一行與 {@link Clock.transportNow} 都要改成由 Intl 取得偏移。
 */
const TAIPEI_UTC_OFFSET = '+08:00'

const MINUTES_PER_HOUR = 60

const MILLISECONDS_PER_SECOND = 1000

export type Clock = {
  /** 業務時間 `YYYY-MM-DD HH:mm:ss`，台北牆鐘，不帶時區標記（§6.1）。 */
  now(): string
  /** 業務日期 `YYYY-MM-DD`，台北的日曆日。 */
  today(): string
  /** 當日第幾分鐘（0–1439）。跨午夜的時段允許以超過 1440 的值表示，但「現在」不會超過。 */
  minuteOfDay(): number
  /** 傳輸層時戳 `YYYY-MM-DDTHH:mm:ss+08:00`，僅供 `rspTS`／`exp`（§6.1）。 */
  transportNow(): string
  /**
   * 從現在起 N 秒後的業務時間 `YYYY-MM-DD HH:mm:ss`。
   *
   * 存在的理由與 {@link Clock.now} 相同（§6.2）：到期時刻是「現在＋一段長度」，讓底層自己
   * `new Date(Date.now() + ttl)` 就等於把「現在」重新引進來一次，跨日與月底的到期邏輯又變回不可測。
   * 由 clock 產出，測試把 clock 釘死就能精確斷言「這張票到期時刻是不是這一秒」。
   */
  after(seconds: number): string
  /** 從現在起 N 秒後的傳輸層時戳。**只供 envelope 的 `exp`**（§6.1），不得當業務時間用。 */
  transportAfter(seconds: number): string
  /** epoch 毫秒。只供計算時間差（例如 session 剩餘秒數），不得用來格式化業務時間。 */
  epochMs(): number
}

const TAIPEI_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAIPEI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // h23 而非 hour12:false：後者在部分執行環境會把午夜格式化成 24，於是 `24:05:00` 這種
  // 不合法的時間會被寫進 DB，而 pattern 驗證只在對外欄位上跑，內部寫入不會被擋。
  hourCycle: 'h23',
})

type TaipeiWallClock = {
  readonly date: string
  readonly time: string
  readonly minuteOfDay: number
}

const readTaipeiWallClock = (instant: Date): TaipeiWallClock => {
  const parts = TAIPEI_FORMAT.formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)
    if (part === undefined) {
      // 走到這裡代表執行環境的 Intl 資料不完整，屬系統錯誤（§3.1.2）：時間會靜靜地算錯，
      // 不如當場中止。
      throw new Error(`無法取得台北時間的 ${type} 片段，執行環境的 Intl 時區資料可能不完整`)
    }
    return part.value
  }

  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))

  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
    minuteOfDay: hour * MINUTES_PER_HOUR + minute,
  }
}

/**
 * 由「怎麼取得當下瞬間」建立 clock。
 *
 * @param readInstant 回傳當下瞬間；測試以固定值傳入即可重現任何日期。
 */
export const clockFrom = (readInstant: () => Date): Clock => {
  // 「現在」與「現在＋N 秒」共用同一段格式化，不各寫一份：兩份格式化最後必然分岔
  //（一邊補了毫秒、一邊沒有），而分岔的症狀是「寫進 DB 的到期時刻與比對用的字串格式不同」
  // ——字串比大小當場失準，而且不會有任何錯誤訊息。
  const wallClockAt = (offsetSeconds: number): TaipeiWallClock =>
    readTaipeiWallClock(new Date(readInstant().getTime() + offsetSeconds * MILLISECONDS_PER_SECOND))

  return {
    now: () => {
      const wall = wallClockAt(0)
      return `${wall.date} ${wall.time}`
    },
    today: () => wallClockAt(0).date,
    minuteOfDay: () => wallClockAt(0).minuteOfDay,
    transportNow: () => {
      const wall = wallClockAt(0)
      return `${wall.date}T${wall.time}${TAIPEI_UTC_OFFSET}`
    },
    after: (seconds) => {
      const wall = wallClockAt(seconds)
      return `${wall.date} ${wall.time}`
    },
    transportAfter: (seconds) => {
      const wall = wallClockAt(seconds)
      return `${wall.date}T${wall.time}${TAIPEI_UTC_OFFSET}`
    },
    epochMs: () => readInstant().getTime(),
  }
}

/** 正式環境使用的 clock。這是全專案唯一呼叫 `new Date()` 的位置。 */
export const systemClock: Clock = clockFrom(() => new Date())

/** 測試用：把「現在」釘在指定瞬間。 */
export const fixedClock = (instant: Date): Clock => clockFrom(() => instant)
