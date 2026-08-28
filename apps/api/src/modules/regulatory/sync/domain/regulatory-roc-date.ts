/**
 * 民國日期 → 西元日曆日（零 IO 純函式，§0.1）。
 *
 * 政府資料裡的日期幾乎都是民國年，而且是**沒有分隔符號的一串數字**：
 * `1150101` = 民國 115 年 1 月 1 日 = 西元 2026-01-01。勞保投保薪資分級表（`dataset_code=1`）的
 * `適用起日` 就是這個形態，而那一欄是整個版本的 `effective_from` 唯一的來源（計畫 §7.0）。
 *
 * ## 為什麼要一支獨立的純函式，而不是在解析器裡寫一行 `Number(...)`
 *
 * 這是計畫 §7.2 那條規則落到程式碼上的位置：**推導不出生效日一律失敗，不得猜。**
 * 一行 `+1911` 的寫法在遇到 `1150001`（月份 0）、`1140229`（民國 114 年不是閏年）這種值時
 * 不會拋錯，只會算出一個 `2026-00-01`／`2025-02-29`——**任何日期看起來都是合理的日期**，
 * 沒有一個斷言能說它不對，而它會被寫進 `effective_from`，悄悄改變「這個資料集現在該算哪一版」。
 *
 * 因此本檔的回傳值是一個**可辨識聯集**：不處理失敗分支就取不到日期字串，編譯不過。
 *
 * ## 一律回字串，全程不經過 `Date`
 *
 * `Date` 一定帶時區，換算一旦進到流程裡就有漏換算與換錯方向的可能，而錯的形式是「日期差一天」
 * ——對法規版本而言那就是「跨年那一天用錯版本」（§6，同 `db/schema` 對 `effective_from` 的處置）。
 * 這裡從頭到尾只做整數運算與字串組裝，閏年規則自己算（見 {@link daysInMonth}）。
 */

/** 民國元年（1912）對應的西元年減一。民國 N 年 = 西元 N + 1911。 */
const ROC_EPOCH_OFFSET = 1911

const MONTHS_PER_YEAR = 12

/**
 * 各月天數（1 月起）。2 月由 {@link daysInMonth} 依閏年規則覆寫。
 *
 * 寫成常數表而不是 `new Date(year, month, 0).getDate()`：後者要建一個 `Date`，
 * 而本檔存在的理由之一就是全程不碰 `Date`（見檔頭）。
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * 西元年的閏年規則：四年一閏、百年不閏、四百年再閏。
 *
 * **必須是完整的三條規則**，不能只寫 `year % 4 === 0`：1900 與 2100 都不是閏年，
 * 而少了後兩條在 2100-02-29 那一天才會發作——那時沒有人記得這裡曾經簡化過。
 */
const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0)

/**
 * 轉換結果。
 *
 * **失敗分支帶 `reason` 而不是回 `null`**：這個字串最後會進 `regulatory_sync_logs.error_message`，
 * 而那是事後要回答「為什麼那三天沒同步」時唯一的線索（計畫 §3.4）。回 `null` 的話，
 * 記錄裡只剩一句「解析失敗」，看的人分不出是格式變了、還是某一列的日期壞了。
 */
export type RocDateResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string }

/** `YYYMMDD`（民國年三位）或 `YYMMDD`（民國 100 年以前的兩位年）。 */
const ROC_COMPACT_PATTERN = /^(\d{2,3})(\d{2})(\d{2})$/

const pad2 = (value: number): string => String(value).padStart(2, '0')

/**
 * 民國 `YYYMMDD` → 西元 `YYYY-MM-DD`。
 *
 * @param value 政府資料裡的原字串，例如 `1150101`。前後空白會先去掉——政府的 CSV／JSON
 *   偶爾帶著補齊欄寬的空白，而那不是「格式變了」，只是空白。
 *
 * 接受 6 碼與 7 碼兩種長度：民國 100 年以前是 `YYMMDD`（`991231` = 1910-12-31）。
 * **不接受其他長度**，尤其不接受 8 碼——`20260101` 是西元寫法，把它當民國會算出 2027 年，
 * 那正是本檔要防的「看起來完全合理的錯日期」。
 *
 * 民國元年是第 1 年，沒有第 0 年，因此 `year >= 1`（`0000101` 一律失敗）。
 */
export const parseRocCompactDate = (value: string): RocDateResult => {
  const trimmed = value.trim()
  const matched = ROC_COMPACT_PATTERN.exec(trimmed)
  if (matched === null) {
    return { ok: false, reason: `民國日期格式無法辨識（期望 YYMMDD 或 YYYMMDD）：${JSON.stringify(value)}` }
  }

  // 三段都由 `\d{2,3}`／`\d{2}` 比對而來，`Number` 不可能得到 NaN；解構的 undefined 分支
  // 是 `noUncheckedIndexedAccess` 要求的形式，實際上走不到。
  const rocYear = Number(matched[1] ?? '')
  const month = Number(matched[2] ?? '')
  const day = Number(matched[3] ?? '')

  if (rocYear < 1) {
    return { ok: false, reason: `民國年不得為 0（民國元年是第 1 年）：${JSON.stringify(value)}` }
  }
  if (month < 1 || month > MONTHS_PER_YEAR) {
    return { ok: false, reason: `民國日期的月份不合法：${JSON.stringify(value)}` }
  }

  const year = rocYear + ROC_EPOCH_OFFSET
  const lastDay = daysInMonth(year, month)
  if (day < 1 || day > lastDay) {
    // 這一條擋的是 `1140229`：民國 114 年（西元 2025）不是閏年，2 月只有 28 天。
    // 少了它會得到一個 `2025-02-29`，寫進 DB 的 `date` 欄位會被 MariaDB 悄悄轉成 `0000-00-00`
    // 或直接報一個看不出成因的錯，兩種都比在這裡明講「哪一個值壞了」差。
    return { ok: false, reason: `民國日期的日不合法（${year}-${pad2(month)} 只有 ${lastDay} 天）：${JSON.stringify(value)}` }
  }

  return { ok: true, value: `${String(year)}-${pad2(month)}-${pad2(day)}` }
}
