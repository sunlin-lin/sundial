/**
 * `YYYY-MM` → 該月第一天／最後一天（`YYYY-MM-DD`），零 IO 純函式（計畫 §5 Stage 7：`list`／
 * `list-own` 都按年月查詢，需要把 `YearMonth` 換算成 `attendance_results.work_date` 的
 * `BETWEEN` 範圍）。
 *
 * **不經過 `Date` 物件**：理由與 `attendance-result-engine.ts` 的 `parseTaipeiDateTimeToUtcMs`
 * 檔頭同一個判斷——`new Date(year, month, 0)` 這種「用日期 0 取得上個月最後一天」的技巧雖然常見，
 * 但依賴 `Date` 建構子對本地時區分量的解讀，讀出來的值理論上與執行環境的系統時區設定無關（因為
 * 全程只用本地分量存取），可是既然沒有系統時區依賴，用純算術表達同一件事更直接、也更容易測試
 * 邊界（閏年、月底），不需要為了「其實安全」的 `Date` 用法多花一層理由說明。
 *
 * @param yearMonth 已經過 `routes` 的 `YearMonth` pattern（`^\d{4}-(?:0[1-9]|1[0-2])$`）驗證，
 *   這裡不重複驗證格式——輸入不合法時 `Number(...)` 會產生 `NaN`，交由呼叫端的型別系統與 schema
 *   驗證擋在更前面，這裡假設輸入永遠合法（純函式，不對外開放，不接受非法輸入是既有的前提）。
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const lastDayOfMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 31)

export type MonthRange = { readonly start: string; readonly end: string }

export const resolveMonthRange = (yearMonth: string): MonthRange => {
  const [yearText = '', monthText = ''] = yearMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  return {
    start: `${yearText}-${monthText}-01`,
    end: `${yearText}-${monthText}-${lastDayOfMonth(year, month).toString().padStart(2, '0')}`,
  }
}
