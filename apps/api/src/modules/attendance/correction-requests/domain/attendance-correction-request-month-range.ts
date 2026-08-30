/**
 * `YYYY-MM` → 該月第一天／最後一天（`YYYY-MM-DD`），零 IO 純函式。
 *
 * **這是刻意複製，不是跨次目錄 import**：`attendance/results` 已經有一支邏輯相同的
 * `resolveMonthRange`（`domain/attendance-result-month-range.ts`），但 `domain/` 不透過對方的
 * service 入口匯出，理由與本目錄 `attendance-correction-request-period-lock.ts` 檔頭相同——
 * 這是一段不含業務規則、不隨月曆規則以外的任何事情變動的純函式，就地複製一份。
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
