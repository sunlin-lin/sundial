/**
 * 業務日期與時間的顯示格式化：**字串進、字串出，不經過 `Date`**。
 *
 * ## 為什麼是字串裁切，而不是 `new Date(...)`
 *
 * 全系統一律台北時間（`Asia/Taipei`），API 傳來的 `datetime` 就是台北牆鐘時間、
 * 格式 `YYYY-MM-DD HH:mm:ss` 且**不帶時區標記**，`date` 為 `YYYY-MM-DD`（後端規範 §6.1）。
 * 這種字串丟進 `new Date(...)` 會被當成**瀏覽器所在時區**的時間，之後任何輸出都可能被再換算一次
 * ——使用者把筆電時區設成東京，整批時間就多一小時，畫面上不會有任何錯誤提示，
 * 而使用者會據此做出判定（§9.2）。字串進、字串出，這個失敗模式就不存在。
 *
 * 本目錄是 §9.2「format 模組以外禁止 `new Date(` / `Date.now(`」的例外所在，但**本檔一個都不用**
 * ——顯示既有的時間字串完全不需要 `Date`，用了才是把上面那個失敗模式請回來。
 *
 * ## 一律西元，不轉民國（計畫 §5.1，已定案）
 *
 * 政府公告用民國，資料庫存西元，畫面顯示西元。理由不是哪一種比較好，而是**系統其他地方
 * （到職日、離職日、薪資期間、請假日期）全部是西元**。只有法規那一頁用民國的話，
 * 讀的人每看一個日期都要先判斷「這一格是哪一種紀年」——而**判斷錯的代價是差 1911 年**，
 * 看起來像資料壞掉。因此本檔**刻意沒有**任何民國轉換函式：不是還沒做，是不做。
 *
 * 唯一的例外在計畫 §5.1 也寫死了：**同步失敗原因裡的民國年不轉換**，那是後端從政府原文
 * 抄出來的整段文字，改寫它會讓人對不上公告。那一段是原文照印，不經過本檔任何一支函式。
 *
 * ## 三種輸入、三種處置
 *
 * | 輸入 | 處置 | 為什麼 |
 * |---|---|---|
 * | 合法的業務時間字串 | 裁切後輸出 | 正常路徑 |
 * | `null` / `undefined` / 空字串 | `EMPTY_DISPLAY` | 「沒有值」是合法狀態（未結束的同步沒有結束時間） |
 * | **帶時區標記**（`T` / `Z` / `+08:00`） | `EMPTY_DISPLAY` | 見下，這是本層唯一一處「安靜隱藏」 |
 * | 其他讀不懂的字串 | **原樣輸出** | 同 `decimal.ts`：讓格式變更被看見 |
 *
 * **為什麼帶時區標記的字串必須隱藏，而不是像其他讀不懂的字串一樣原樣輸出。**
 * §9.2 對這件事的措辭是「帶時區偏移的時間字串**一律不上畫面，沒有例外**」——`rqTS` / `rspTS` /
 * `exp` 三者只供 log 與除錯。原樣輸出等於讓它上畫面，直接違反那條零例外的規則。
 *
 * **這樣做的代價要誠實寫下來**：一個漏出來的 `rspTS` 會表現成一格 `—`，而 `—` 是合法狀態，
 * 於是沒有人會查。**發現它不是這一層的責任**：§9.2 已經把偵測指派給掃描規則
 * （禁止 session 模組以外引用 `exp`、禁止頁面顯示邏輯處理帶 `+08:00` / `Z` 的字串）。
 * 本檔只是最後一道閘門——它保證「就算漏了，也不會顯示出去」，不保證「有人會知道漏了」。
 */
import { EMPTY_DISPLAY } from './empty-display.ts'

/**
 * 業務時間字串（後端規範 §6.1 的兩種格式，無時區標記）。
 *
 * 只認這兩種寫法，不接受 `2026/08/26`、不接受省略秒的 `2026-08-26 09:30`。
 * 寬容地多接受幾種寫法，等於讓「後端改了格式」這件事靜靜地通過——而那正是最需要有人看一眼的時刻
 * （理由同後端 `regulatory-amount.ts` 檔頭「每一支都把單位做成參數，而不是兩種都接受」）。
 */
const BUSINESS_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/

/**
 * 帶時區標記的 ISO 8601 字串的特徵。
 *
 * 三種各抓一種寫法：`T` 分隔（`2026-04-14T14:30:00+08:00`）、`Z` 結尾（UTC）、
 * 以及偏移量結尾（`...+08:00`，也可能寫成空白分隔而沒有 `T`）。
 * 只要命中任何一種就代表這是傳輸層時戳或 session 的 `exp`，一律不上畫面。
 */
const TIMEZONE_MARKED_PATTERN = /T|Z$|[+-]\d{2}:\d{2}$/

/** 裁切位置。寫成具名常數而不是散在三支函式裡的 `10` / `16` / `7`，那三個數字單獨看讀不出意思。 */
const DATE_LENGTH = 10
const DATE_TIME_LENGTH = 16
const YEAR_MONTH_LENGTH = 7

/**
 * 共用的入口處置：判斷這個輸入屬於上面那張表的哪一列。
 *
 * @returns `undefined` 代表呼叫端應該輸出 `EMPTY_DISPLAY`（沒有值，或帶時區標記）；
 *   否則回傳去掉前後空白的字串，`isBusinessTime` 為 `false` 時代表讀不懂、應該原樣輸出。
 */
type ClassifiedTime = { readonly text: string; readonly isBusinessTime: boolean }

const classify = (value: string | null | undefined): ClassifiedTime | undefined => {
  if (value === null || value === undefined) return undefined

  const text = value.trim()
  if (text === '') return undefined

  // 帶時區標記者一律當成「沒有值」，理由與代價見檔頭。順序必須排在 pattern 比對之前：
  // `2026-04-14T14:30:00+08:00` 的前 10 個字元是一個合法的日期，裁切之後看起來完全正常，
  // 而它其實是「回應產生的時刻」，跟該筆業務事件發生的時刻是兩回事。
  if (TIMEZONE_MARKED_PATTERN.test(text)) return undefined

  return { text, isBusinessTime: BUSINESS_TIME_PATTERN.test(text) }
}

/** 三支函式的共同形狀：讀得懂就裁到指定長度，讀不懂就原樣輸出，沒有值就 `EMPTY_DISPLAY`。 */
const sliceBusinessTime = (value: string | null | undefined, length: number): string => {
  const classified = classify(value)
  if (classified === undefined) return EMPTY_DISPLAY
  if (!classified.isBusinessTime) return classified.text
  return classified.text.slice(0, length)
}

/**
 * 日期顯示（`YYYY-MM-DD`）。
 *
 * 輸入可以是 `date`（`2026-08-26`）也可以是 `datetime`（`2026-08-26 09:30:00`）——
 * 後者取日期的部分。**刻意接受兩種**：這一支的語意是「我只要日期」，而呼叫端手上那一欄
 * 是哪一種由後端 schema 決定，逼呼叫端先分辨會讓每個呼叫點都多一次判斷。
 *
 * ```ts
 * formatDate('2026-08-26')            // '2026-08-26'
 * formatDate('2026-08-26 09:30:00')   // '2026-08-26'
 * formatDate(null)                    // '—'
 * ```
 */
export const formatDate = (value: string | null | undefined): string => sliceBusinessTime(value, DATE_LENGTH)

/**
 * 日期時間顯示（`YYYY-MM-DD HH:mm`，24 小時制，§9.2）。**秒不顯示**。
 *
 * 輸入是 `date`（沒有時間的部分）時輸出就只有日期，**不補 `00:00`**：補上去等於宣稱
 * 「這件事發生在午夜」，而實際上是「這一欄沒有時間」。兩者在畫面上必須看得出差別。
 *
 * ```ts
 * formatDateTime('2026-08-26 09:30:45')   // '2026-08-26 09:30'
 * formatDateTime('2026-08-26')            // '2026-08-26'
 * ```
 */
export const formatDateTime = (value: string | null | undefined): string => sliceBusinessTime(value, DATE_TIME_LENGTH)

/**
 * 年月顯示（`YYYY-MM`，§9.2）。薪資期間、法規生效月份這類欄位用。
 *
 * ```ts
 * formatYearMonth('2026-08-26')   // '2026-08'
 * ```
 */
export const formatYearMonth = (value: string | null | undefined): string =>
  sliceBusinessTime(value, YEAR_MONTH_LENGTH)
