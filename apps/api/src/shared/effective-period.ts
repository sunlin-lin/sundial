/**
 * 有效期間重疊判斷（零 IO 純函式）。
 *
 * **兩個以上真實的 import 者**（§0.6.3 第 1 條）：`modules/employments/department-histories/`
 * 與 `modules/withholding/main/` 都要判斷「新的一筆有效期間，會不會跟同一個擁有者既有的期間重疊」
 * ——兩處的規則逐字相同（計畫 `plans/05-employee-onboarding.md` §4.3），差別只在「擁有者」是任職
 * 還是員工。抽出來是為了不讓同一段比較邏輯在兩個模組各寫一份、日後各自演化出不同的邊界判斷。
 *
 * **沒有生命週期**（第 2 條）：純函式，不持有任何狀態。
 *
 * **不知道自己被誰用**（第 3 條）：只認得 `{ effectiveFrom, effectiveTo }` 這個形狀，
 * 不 import 任何模組或資料庫型別。
 *
 * `employee_employments` 的到職／離職日（`hireDate`／`leaveDate`）雖然欄位名不同，但形狀完全一樣
 * ——「一段開始日期必填、結束日期選填的期間」，因此 `modules/employments/main/` 的重疊檢查
 * 也用這一支，呼叫端把 `hireDate` 映到 `effectiveFrom`、`leaveDate` 映到 `effectiveTo` 即可。
 */

/** 一段有效期間。日期一律 `YYYY-MM-DD`（業務日期，§6.1），`effectiveTo` 為 `null` 代表尚未結束。 */
export type EffectivePeriod = {
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/**
 * 兩段期間會不會重疊（含端點：`effectiveTo` 當天仍算有效，因此兩段首尾相接的那一天算重疊——
 * 「結束當天」與「開始當天」不可能是同一個擁有者的兩段有效期間）。
 *
 * `effectiveTo === null` 視為「無限延伸到未來」，比較時换成一個字典序大於任何合法業務日期的哨兵值
 * ——業務日期是 `YYYY-MM-DD` 四位數年份，`'9999-12-31'` 字典序必然大於任何一個合法值，
 * 因此可以直接用字串比較（`YYYY-MM-DD` 的字典序與時序等價）而不必解析成 `Date`。
 */
const OPEN_ENDED_SENTINEL = '9999-12-31'

const effectiveEndOf = (period: EffectivePeriod): string => period.effectiveTo ?? OPEN_ENDED_SENTINEL

/** 兩段期間是否重疊：`a` 的起點不晚於 `b` 的終點，且 `b` 的起點不晚於 `a` 的終點。 */
const periodsOverlap = (a: EffectivePeriod, b: EffectivePeriod): boolean =>
  a.effectiveFrom <= effectiveEndOf(b) && b.effectiveFrom <= effectiveEndOf(a)

/**
 * 新的一筆期間，是否與既有清單裡的任何一筆重疊。
 *
 * @param existingPeriods 同一個擁有者**目前全部**的有效期間（呼叫端必須在同一次交易、拿到鎖之後
 *   查出的完整清單——漏了任何一筆都會讓真正的重疊被誤判為安全，見各呼叫端的 `FOR UPDATE` 說明）。
 * @param candidate 準備寫入的新期間。
 */
export const overlapsAnyPeriod = (existingPeriods: readonly EffectivePeriod[], candidate: EffectivePeriod): boolean =>
  existingPeriods.some((existing) => periodsOverlap(existing, candidate))
