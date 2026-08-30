/**
 * 分鐘數的顯示格式化（前端規範 §1.3 第 (1) 類，共用版）。
 *
 * ## 為什麼在 `shared/format/`
 *
 * §1.5：兩個以上頁面實際共用時才移入共用區。全體出勤（`pages/attendance/all/`）與我的出勤
 * （`pages/attendance/mine/`）是本輪一起新增的兩頁，兩頁的列表都要把 `workedMinutes` 顯示成
 * 「H.M 小時」，我的出勤還要把整月的 `workedMinutes` 加總——因此這裡從第一天就有兩個使用者，
 * 不是「先放著以備不時之需」（§1.5 明文禁止的那種）。
 *
 * **這裡搬的其實是既有的技術欠帳**：`pages/shifts/main/shifts-main.duration.view.ts` 的
 * `minutesToHoursDisplay`（連同它自己私有的 `toSafeMinutes`），以及
 * `pages/dashboard/main/dashboard-main.view.ts` 的 `workedHoursDisplay`，各自的檔頭都已經寫著
 * 「這是本輪的技術欠帳，下一個有權限碰 `shared/format/` 的人應該把它搬過來，讓全站『分鐘→小時』
 * 只有一份實作」。本輪任務範圍涵蓋 `shared/format/`，因此把演算法搬到這裡供兩個新頁面使用；
 * **但刻意不回頭改寫 `shifts-main`／`dashboard-main` 既有的兩份私有實作**——那兩頁已經上線、
 * 通過 CI，回頭改寫要同時碰三個頁面的呼叫點與測試，超出本輪「全體出勤／我的出勤」兩頁的範圍，
 * 留在任務回報中列成後續可做的收斂，不在這裡動手（避免無界的範圍擴張）。
 *
 * ## 為什麼函式不帶單位、不吃 `translate`
 *
 * 比照 `decimal.ts` 的 `formatAmount`／`formatRate`：「小時」是使用者可見字串，屬於語系檔 key，
 * 不屬於格式化函式——混進來的話，這支函式會被迫長出「要不要帶單位」的參數，而那個參數在每個
 * 呼叫點都要重新決定一次。呼叫端（頁面的 `.view.ts`）自己組 `` `${formatHoursFromMinutes(m)} ${translate('attendance.unit.hours')}` ``。
 *
 * ## 這裡曾經有一支 `toSafeMinutes`，現在拿掉了
 *
 * `attendance/results/list`／`list-own` 回應的 `workedMinutes`／`lateMinutes`／`earlyLeaveMinutes`／
 * `absenceMinutes` 曾經因為 `apps/api/src/shared/field-schemas.ts` 的 `Minutes` 用了 Elysia
 * 重新定義過、可強制轉型的 `t.Integer`，在產生型別上是 `string | number`，不是單純的 `number`
 * ——這正是 `apps/api/scripts/check-response-coercion.ts` 檔頭描述的問題，且已經在 `AccuracyMeters`
 * 修過一次。但 `Minutes` 是從 `field-schemas.ts` **匯入**後在 `attendance-results.routes.ts` 的
 * `response:` 使用，當時屬於那支掃描器自己記載的已知盲區（「跨檔案引用的 schema……在本檔裡沒有
 * 初始化運算式可以展開」，只認得到「本檔頂層 const 宣告」），因此沒有被掃到、也沒有被修正，逼這裡
 * 長出一支 `toSafeMinutes` 專門處理「型別上可能是字串，實際上永遠是資料庫存的整數分鐘」這個落差
 * ——不能用 `as number` 繞過去（§3.2 禁止型別斷言），只好逐位累加成整數當「安全轉換」。
 *
 * 那支掃描器後來補上了跨檔案追蹤（涵蓋 `shared/field-schemas.ts`），`Minutes` 也跟著改成 TypeBox
 * 原生的 `Type.Integer`，`workedMinutes` 等四個欄位的產生型別收斂回純 `number`
 * （`bun run gen:api` 之後可在 `apps/web/src/api/generated/api-types.ts` 驗證）。契約既然保證
 * 是 `number`，字串那條處理路徑就是死碼——留著只會讓下一個人以為 API 真的可能回字串，因此拿掉
 * `toSafeMinutes`，呼叫端直接讀 `item.workedMinutes` 等欄位。
 */
const MINUTES_PER_HOUR = 60
const TENTHS_PER_HOUR = 10

/**
 * 分鐘 → 「H.M」小時數字字串（不含單位，見檔頭）。
 *
 * 全程整數運算（`Math.round`／`Math.floor`／`%`），不經過小數；「小數一位」的那一位是四捨五入到
 * 最接近的 6 分鐘（`60 分鐘 ÷ 10`），不是把 `minutes / 60` 的浮點結果截斷。輸入只會是 §9.2 定義的
 * 分鐘數（`Minutes` 的 `minimum: 0`），不處理負數。
 *
 * ```ts
 * formatHoursFromMinutes(0)     // '0.0'
 * formatHoursFromMinutes(90)    // '1.5'
 * formatHoursFromMinutes(511)   // '8.5'   511 分鐘四捨五入到最接近的 6 分鐘 = 510 分鐘 = 8.5 小時
 * ```
 */
export const formatHoursFromMinutes = (minutes: number): string => {
  const totalTenths = Math.round((minutes * TENTHS_PER_HOUR) / MINUTES_PER_HOUR)
  const whole = Math.floor(totalTenths / TENTHS_PER_HOUR)
  const tenth = totalTenths % TENTHS_PER_HOUR
  return `${whole}.${tenth}`
}
