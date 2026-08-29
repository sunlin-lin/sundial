/**
 * `attendance` 大目錄的唯一出口（§0.3）。
 *
 * **只有 re-export，沒有任何宣告、常數或函式本體**：`index.ts` 是唯一沒有層後綴的檔案，
 * 所有分層規則都不以它為對象——不限制的話它會長成一個沒有任何規則管得到的第六層。
 *
 * **只 export service 與 errors，不 export repository 與 routes**：re-export repository 會讓
 * 跨模組的一行 import 把資料庫連線一起拖進來，而「裸 db client 限資料存取層」那條規則會被繞過。
 * 跨大目錄要資料，一律走 service。
 *
 * 本輪多了 `results` 次目錄（實作計畫 `plans/06-attendance.md` §4.1、§5 Stage 4）：
 * `recalculateAttendanceResultForWorkDay` 供 `records` 次目錄的 `revoke`／`revoke-other` 編排
 * 進同一筆交易（見兩支 service 的呼叫）。`correction-requests`／`correction-reviews` 排在後續
 * 階段，屆時在這裡各加一行。
 */
export * from './settings/attendance-settings.service.ts'
export * from './settings/attendance-settings.errors.ts'
export * from './records/attendance-records.service.ts'
export * from './records/attendance-records.errors.ts'
export * from './results/attendance-results.service.ts'
export * from './results/attendance-results.errors.ts'
