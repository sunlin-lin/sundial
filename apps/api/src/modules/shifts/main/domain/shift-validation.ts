/**
 * 時段與休息的結構驗證，以及推導值的計算（零 IO 純函式，計畫 §4.1、§5.2）。
 *
 * **兩件事分成兩個函式，且順序固定為「先驗證、驗證通過才計算」**：{@link validateShiftStructure}
 * 只負責回答「這組時段與休息合不合法」，{@link computeShiftDerivedValues} 假設已經合法，
 * 專心把 `workMinutes`／`breakMinutes`／`isOvernight`／`requiredWorkMinutes` 算出來。
 * 不合併成一個函式，是因為驗證要**收集全部錯誤**（§3.1.1），而計算只需要**一組答案**——
 * 合在一起會逼計算那一半也用迴圈提早結束的寫法，兩種需求互相污染。
 *
 * §3.1.1「業務錯誤要收集，不要在第一筆就中斷」在這裡特別容易寫壞：本檔驗證的是**陣列**，
 * 最順手的寫法是一邊跑迴圈一邊 `return`。因此下面每一個 `collect*` 函式都跑完整個陣列、
 * 把找到的所有問題都收集起來，沒有提早結束的路徑。
 *
 * **`computeShiftDerivedValues` 排在 `validateShiftStructure` 前面宣告**：後者在結構檢查全數
 * 通過之後，要呼叫前者算出 `requiredWorkMinutes` 才能做最後一道「必須大於 0」的檢查
 * （見該函式檔頭），因此宣告順序必須顛倒過來，不是隨手排列。
 */
import {
  shiftBreakInvalidRange,
  shiftBreaksOverlap,
  shiftBreakOutsideWorkPeriod,
  shiftBreakSequenceDuplicated,
  shiftRequiredWorkMinutesNotPositive,
  shiftWorkPeriodInvalidRange,
  shiftWorkPeriodSequenceDuplicated,
  shiftWorkPeriodsEmpty,
  shiftWorkPeriodsOverlap,
} from '../shifts-main.errors.ts'
import type { DomainError } from '../../../../shared/service-result.ts'
import { toAbsoluteMinutes } from './shift-time.ts'
import type { ShiftBreak, ShiftBreakInput, ShiftWorkPeriod, ShiftWorkPeriodInput } from './shift-model.ts'

/** 帶著原始陣列位置的絕對分鐘區間，驗證與計算都需要先算出這個中繼形狀。 */
type IndexedRange = {
  readonly index: number
  readonly startAbs: number
  readonly endAbs: number
}

const toIndexedWorkPeriodRanges = (workPeriods: readonly ShiftWorkPeriodInput[]): readonly IndexedRange[] =>
  workPeriods.map((period, index) => ({
    index,
    startAbs: toAbsoluteMinutes(period.startTime, 0),
    endAbs: toAbsoluteMinutes(period.endTime, period.endDayOffset),
  }))

const toIndexedBreakRanges = (breaks: readonly ShiftBreakInput[]): readonly IndexedRange[] =>
  breaks.map((entry, index) => ({
    index,
    startAbs: toAbsoluteMinutes(entry.startTime, entry.startDayOffset),
    endAbs: toAbsoluteMinutes(entry.endTime, entry.endDayOffset),
  }))

/** 找出起訖換算後不是正值的項目（最常見成因：跨日卻忘了把日偏移設成 1）。 */
const collectInvalidRanges = (
  ranges: readonly IndexedRange[],
  toError: (index: number) => DomainError,
): readonly DomainError[] =>
  ranges.filter((range) => range.endAbs <= range.startAbs).map((range) => toError(range.index))

/**
 * 找出彼此重疊的區間，**同一套演算法同時服務工作時段與休息時段**——兩者都是「一組不得互相
 * 交集的區間」，差別只在重疊的後果不同（工作時段重疊是形狀不合理；休息時段重疊會讓
 * `requiredWorkMinutes` 把同一段時間的無薪休息扣兩次，計算就錯了），因此**不寫第二份比較邏輯**，
 * 只是呼叫端各自帶不同的 `toError`。
 *
 * 演算法：先依開始時刻排序，只比較相鄰兩段。這對「找出是否存在任何一組重疊」是足夠的——
 * 排序後若第 i 段與第 i+1 段不重疊（`end_i <= start_{i+1}`），則 `end_i` 必然也 `<= start_{i+2}`
 * （因為 `start_{i+1} <= start_{i+2}`），所以第 i 段也不會與更後面的任何一段重疊。
 *
 * 只對「無效區間」（{@link collectInvalidRanges} 已找到的那些）略過重疊比較：一個起訖顛倒的
 * 區間拿去跟別的比較沒有意義，且會冒出一堆衍生的假重疊錯誤，掩蓋掉真正的問題。
 *
 * @param toError 依「較晚出現在原始陣列中的那一段」「較早的那一段」的順序建構錯誤——固定順序
 *   是為了讓同一組重疊在測試與畫面上有穩定、可預期的呈現方式。
 */
const collectOverlaps = (
  ranges: readonly IndexedRange[],
  toError: (laterIndex: number, earlierIndex: number) => DomainError,
): readonly DomainError[] => {
  const valid = ranges.filter((range) => range.endAbs > range.startAbs)
  const sorted = [...valid].sort((left, right) => left.startAbs - right.startAbs)
  const errors: DomainError[] = []

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (current === undefined || next === undefined) continue
    if (next.startAbs < current.endAbs) {
      const [earlierIndex, laterIndex] =
        current.index < next.index ? [current.index, next.index] : [next.index, current.index]
      errors.push(toError(laterIndex, earlierIndex))
    }
  }

  return errors
}

/** 找出沒有完整落在任何一段工作時段內的休息（已排除本身起訖顛倒的休息，理由同重疊檢查）。 */
const collectBreaksOutsideWorkPeriods = (
  breakRanges: readonly IndexedRange[],
  workPeriodRanges: readonly IndexedRange[],
): readonly DomainError[] => {
  const validWorkPeriods = workPeriodRanges.filter((range) => range.endAbs > range.startAbs)

  return breakRanges
    .filter((entry) => entry.endAbs > entry.startAbs)
    .filter(
      (entry) => !validWorkPeriods.some((period) => period.startAbs <= entry.startAbs && entry.endAbs <= period.endAbs),
    )
    .map((entry) => shiftBreakOutsideWorkPeriod(entry.index))
}

/** 找出 `sequenceNo` 重複的項目：保留每個值第一次出現的位置，之後每次重複各回一筆錯誤。 */
const collectDuplicateSequenceNumbers = <T extends { readonly sequenceNo: number }>(
  items: readonly T[],
  toError: (index: number) => DomainError,
): readonly DomainError[] => {
  const seen = new Set<number>()
  const errors: DomainError[] = []
  items.forEach((item, index) => {
    if (seen.has(item.sequenceNo)) {
      errors.push(toError(index))
      return
    }
    seen.add(item.sequenceNo)
  })
  return errors
}

/**
 * 計算推導值（計畫 §4.1）：**只在結構檢查（起訖顛倒、重疊、休息越界、順序重複）全數通過之後
 * 呼叫**——本函式不重新驗證，起訖顛倒的區間在這裡會算出負的 `workMinutes`，那不是本函式要擋的。
 *
 * - `isOvernight` ＝ 任一工作時段的 `endDayOffset > 0`。
 * - `requiredWorkMinutes` ＝ 各工作時段 `workMinutes` 總和 － 無薪休息的 `breakMinutes` 總和。
 */
export const computeShiftDerivedValues = (
  workPeriods: readonly ShiftWorkPeriodInput[],
  breaks: readonly ShiftBreakInput[],
): {
  readonly workPeriods: readonly ShiftWorkPeriod[]
  readonly breaks: readonly ShiftBreak[]
  readonly isOvernight: boolean
  readonly requiredWorkMinutes: number
} => {
  const resolvedWorkPeriods = workPeriods.map((period) => ({
    ...period,
    workMinutes: toAbsoluteMinutes(period.endTime, period.endDayOffset) - toAbsoluteMinutes(period.startTime, 0),
  }))
  const resolvedBreaks = breaks.map((entry) => ({
    ...entry,
    breakMinutes:
      toAbsoluteMinutes(entry.endTime, entry.endDayOffset) - toAbsoluteMinutes(entry.startTime, entry.startDayOffset),
  }))

  const totalWorkMinutes = resolvedWorkPeriods.reduce((sum, period) => sum + period.workMinutes, 0)
  const totalUnpaidBreakMinutes = resolvedBreaks
    .filter((entry) => !entry.isPaid)
    .reduce((sum, entry) => sum + entry.breakMinutes, 0)

  return {
    workPeriods: resolvedWorkPeriods,
    breaks: resolvedBreaks,
    isOvernight: workPeriods.some((period) => period.endDayOffset > 0),
    requiredWorkMinutes: totalWorkMinutes - totalUnpaidBreakMinutes,
  }
}

/**
 * 驗證一整組工作時段與休息時段（計畫 §5.2）。回傳空陣列代表通過。
 *
 * **驗證順序刻意讓後面的檢查建立在前面已經濾掉無效資料的基礎上**（起訖顛倒的項目不會被拿去比
 * 重疊或比是否落在工作時段內），但**回傳的錯誤仍然是全部收集齊的**——一次違反多條規則的請求
 * 一次就能看到全部問題，不必修一條、送一次、再被退回一次（§3.1.1）。
 *
 * **最後一道防線：結構全數通過後，仍要檢查 `requiredWorkMinutes` 是不是正值。** 這一條不是
 * 「休息重疊」的重複檢查，是它的**獨立備援**——休息重疊已經由 `collectOverlaps(breakRanges, …)`
 * 擋住，但那條規則若日後被放寬（例如允許休息重疊以表達「輪流去吃飯」這類情境），
 * `requiredWorkMinutes` 仍然可能因為無薪休息總分鐘數超過工作時段總分鐘數而變成 0 或負數，
 * 而**「應工作零分鐘」的班別在業務上永遠不合理**，不該依賴任何一條前面的檢查才擋得住。
 * 這一步因此不重複比較休息彼此的時間，只看最後算出來的那個數字。
 */
export const validateShiftStructure = (
  workPeriods: readonly ShiftWorkPeriodInput[],
  breaks: readonly ShiftBreakInput[],
): readonly DomainError[] => {
  // 零段工作時段（計畫 §5.2）：`requiredWorkMinutes` 會變成 0 或負數，這個班別毫無意義。
  // 這一條不放進 request schema 的 `minItems`（見 routes 檔的說明）：把它與重疊、休息越界這些
  // 同樣「必須算過才知道」的規則放在同一個地方檢查，使用者一次表單送出能一次看到全部問題，
  // 不必先被 schema 擋一次（拿不到 errors[]，只有一句通用訊息），改完再撞見業務規則擋第二次。
  if (workPeriods.length === 0) return [shiftWorkPeriodsEmpty()]

  const workPeriodRanges = toIndexedWorkPeriodRanges(workPeriods)
  const breakRanges = toIndexedBreakRanges(breaks)

  const structuralErrors = [
    ...collectInvalidRanges(workPeriodRanges, shiftWorkPeriodInvalidRange),
    ...collectDuplicateSequenceNumbers(workPeriods, shiftWorkPeriodSequenceDuplicated),
    ...collectOverlaps(workPeriodRanges, shiftWorkPeriodsOverlap),
    ...collectInvalidRanges(breakRanges, shiftBreakInvalidRange),
    ...collectDuplicateSequenceNumbers(breaks, shiftBreakSequenceDuplicated),
    // 休息時段彼此不得重疊：12:00–13:00 與 12:30–13:30 兩段都可能各自落在工作時段內、
    // 也不會被 `collectBreaksOutsideWorkPeriods` 擋到，但重疊的那半小時會在
    // `computeShiftDerivedValues` 裡被扣兩次，讓 `requiredWorkMinutes`（出勤判定的分母）算少。
    ...collectOverlaps(breakRanges, shiftBreaksOverlap),
    ...collectBreaksOutsideWorkPeriods(breakRanges, workPeriodRanges),
  ]
  if (structuralErrors.length > 0) return structuralErrors

  const derived = computeShiftDerivedValues(workPeriods, breaks)
  if (derived.requiredWorkMinutes <= 0) return [shiftRequiredWorkMinutesNotPositive(derived.requiredWorkMinutes)]

  return []
}
