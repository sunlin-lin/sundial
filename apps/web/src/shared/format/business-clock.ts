/**
 * 「現在」是哪一天（前端規範 §9.2：**需要「現在」時由統一的 clock 函式提供台北時間字串，
 * 不在頁面裡各自 `new Date()`**）。
 *
 * ## 為什麼不是一行 `new Date().toISOString().slice(0, 10)`
 *
 * 那一行在台北時間凌晨 0 點到早上 8 點之間會回**昨天**——`toISOString()` 給的是 UTC，
 * 而全系統一律台北時間（`Asia/Taipei`, UTC+8，後端規範 §6.1）。症狀是一個早上開頁面的人，
 * 預設基準日比今天早一天；他不會發現，因為那個日期看起來完全正常，只是查到的可能是前一版法規。
 * `toISOString()` 也在 §9.2 的禁用清單上，理由就是這個。
 *
 * 反過來，`new Date().getFullYear()` 這類本地時間的取法則是「使用者的裝置時區是什麼就給什麼」
 * ——把筆電時區設成東京的人會拿到不同的今天。兩種寫法都不報錯，錯的方式不同而已。
 *
 * 因此這裡明寫 `timeZone: 'Asia/Taipei'` 並用 `formatToParts` 逐段取值：
 * **時區是被指定的，不是被繼承的**，而輸出的組法是我們自己寫的，不依賴任何 locale 的日期樣式
 *（`toLocaleDateString` 也在 §9.2 的禁用清單上，理由同樣是「輸出取決於執行環境」）。
 *
 * ## 為什麼在 `shared/format/`
 *
 * §9.2 的掃描規則把「format 模組以外禁止 `new Date(` / `Date.now(`」寫成一條路徑判定。
 * 「取得現在」是全站唯一還需要 `new Date()` 的顯示側需求，放在別處等於替那條規則開一個例外。
 * 本目錄的其他檔案（`business-date.ts` / `decimal.ts`）一個 `Date` 都不用，只有這一支需要。
 */

/**
 * 台北時區的日期分段器。
 *
 * 在模組層建立一次而不是每次呼叫都 new 一個：`Intl.DateTimeFormat` 的建構是這整段裡最貴的一步，
 * 而它是無狀態的。`en-US` 只用來確保曆法是西曆（§5.1：一律西元，不轉民國）——
 * 輸出的字串完全由下面自己組，locale 影響不到它。
 */
const TAIPEI_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * 台北時區的日期＋時間分段器（給 {@link nowInTaipei} 用）。與上面那份分開建立，理由同上：
 * 兩者輸出的欄位數不同，硬併成一份還要在每次呼叫時判斷「這次要不要時間」，不如各自無狀態一份。
 * `hour12: false` 是必要的——Dashboard「今日打卡」§9.2 要求 24 小時制，預設的 `en-US` 是 12 小時制。
 */
const TAIPEI_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** 取一段。取不到時回空字串，交給下面的長度檢查處理（不在這裡拋，理由見 {@link todayInTaipei}）。 */
const partOf = (parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
  parts.find((part) => part.type === type)?.value ?? ''

/**
 * 今天（台北），`YYYY-MM-DD`。
 *
 * 輸出格式與後端的 `date` 欄位逐字相同（後端規範 §6.1），因此它可以直接當成送出的業務日期
 *（例如 `asOfDate`），也可以直接餵給 `formatDate` 顯示——中間不需要任何轉換。
 *
 * ```ts
 * todayInTaipei()   // '2026-08-28'
 * ```
 */
export const todayInTaipei = (): string => {
  const parts = TAIPEI_DATE_PARTS.formatToParts(new Date())
  return `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`
}

/** 部分環境的 `hour12: false` 會在午夜整點輸出 `'24'` 而不是 `'00'`——已知的 `Intl` 實作歧異，
 * 與後端無關，這裡直接正規化，不讓它流到畫面上變成一個看起來壞掉的時鐘。 */
const normalizeHour = (hour: string): string => (hour === '24' ? '00' : hour)

/**
 * 現在（台北），`YYYY-MM-DD HH:mm:ss`——與後端 `TaipeiDateTime` 欄位逐字同格式（後端規範 §6.1），
 * 供 Dashboard 頭部顯示「目前日期與時間」用（UI 定案 10）。**只給顯示用**：這是一次性讀值，
 * 不是響應式的，呼叫端要自己用 `setInterval` 週期性重新呼叫才會像一個會走的時鐘
 * （見 `pages/dashboard/main/dashboard-main.page.vue`）。
 *
 * ```ts
 * nowInTaipei()   // '2026-08-28 14:30:05'
 * ```
 */
export const nowInTaipei = (): string => {
  const parts = TAIPEI_DATE_TIME_PARTS.formatToParts(new Date())
  const date = `${partOf(parts, 'year')}-${partOf(parts, 'month')}-${partOf(parts, 'day')}`
  const time = `${normalizeHour(partOf(parts, 'hour'))}:${partOf(parts, 'minute')}:${partOf(parts, 'second')}`
  return `${date} ${time}`
}
