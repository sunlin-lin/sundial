/**
 * `dataset_code = 3` 勞工退休金月提繳工資分級表的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `6274` 的 JSON 資源（計畫 §7.0 已實地查證，本次同步前又確認過一次）。
 * 實測回傳是一個陣列，62 列，每一列長這樣：
 *
 * ```json
 * {"等級":"1","實際工資/執行業務所得":"1500以下",
 *  "月提繳工資金額/月提繳執行業務所得金額":"1500","生效日":"1150101","備註":""}
 * ```
 *
 * ## 生效日：`生效日` 欄位，處置與 `dataset_code=1` 逐字相同
 *
 * 這是計畫 §7.0 分類裡「最容易」的那一級——生效日就在每一筆資料的欄位裡（民國 YYYMMDD）。
 * 三條檢查與 `regulatory-labor-insurance-salary.ts` 一致：每一列都要有、每一個值都要能轉成
 * 合法的西元日期、**整批必須完全相同**。混進兩個生效日時「這一版從哪天生效」沒有唯一答案，
 * 而挑其中一個正是 §7.2 禁止的推測值。
 *
 * ## 完整性檢查：這裡沒有「身分別」那種封閉清單，守的是**級距的連續性**
 *
 * `dataset_code=1` 靠「四種投保身分別必須齊全」擋住「政府刪掉一類」。這張表只有一套級距、
 * 沒有任何固定代碼欄位，因此沒有那樣的清單可比對（級數是 1…62 的序數，實測歷年版本
 * `13335` 顯示級距數在 61／62／63 之間變動，寫死任何一個數字都會在下一次調整時過期）。
 *
 * 對應物是**級距本身的連續性**，它守的是同一件事——「少了一級會讓某一群人悄悄查不到」：
 *
 * 1. **級數必須從 1 連號到 N**（且與列序一致）。中間少一級 → 出現跳號 → 失敗。
 * 2. **相鄰級距必須首尾相接**（上一級的上限 ＋ 1 ＝ 這一級的下限）。這一條比第 1 條強：
 *    政府若刪掉一級**並且**把後面重新編號，級數仍然連號，但金額會出現一個缺口。
 * 3. **第一級必須沒有下限、最後一級必須沒有上限，中間每一級兩端都要有**。
 *    這一條擋的是**截斷**：只抓到半截資料時，最後一列會是一個上下限都有的普通級距，
 *    而那張表在型別、驗證、資料庫層全部合法——只是月薪超過那個上限的人查不到任何一級。
 *
 * 少了這三條的後果與 `1` 的「少一種身分別」同構：解析成功、版本照樣寫進去、每一級的金額都對，
 * 只是落在缺口裡的人**查不到級距**，而查不到不會拋錯——退休金提繳會算成 0 或掉到隔壁級距，
 * 兩者都是一張金額完全合理的薪資單。
 *
 * ## 數值一律 decimal 字串
 *
 * 全檔沒有一個 `Number(...)` 參與金額（§4.7）。`Number` 只出現在 `sort_order`（列序）上。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { INTEGER_AMOUNT_PATTERN, normalizeAmount, parseAmountRange } from './regulatory-amount.ts'
import { parseRocCompactDate } from './regulatory-roc-date.ts'
import type { ParsedRegulatoryRecord, RegulatoryParseResult } from './regulatory-sync-model.ts'

/** `dataset_code=3` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type LaborPensionContributionWageGrade = RegulatoryRecordData<3>

/**
 * 政府那一份的五個欄位名。**逐字寫出來**：欄位改名要在這裡當場失敗，不要靜靜地讀到 `undefined`。
 *
 * 兩個長欄位名裡的斜線是政府原文的一部分（同一欄同時服務「工資」與「執行業務所得」兩種身分），
 * 抄短一點會比對不到。
 */
const FIELD = {
  grade: '等級',
  actualWage: '實際工資/執行業務所得',
  contributionWage: '月提繳工資金額/月提繳執行業務所得金額',
  effectiveFrom: '生效日',
  remark: '備註',
} as const

/** 級數：正整數字串。 */
const GRADE_PATTERN = /^\d+$/

/** 從政府那一列取一個字串欄位。**缺欄位與空字串都算缺**——後者在 CSV 轉 JSON 時很常見。 */
const readField = (row: Record<string, unknown>, field: string): string | null => {
  const value = row[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 解析勞工退休金月提繳工資分級表。
 *
 * @param rawText 政府 JSON 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 *
 * ## `record_key` 為什麼是 `grade-{級數}`
 *
 * 資料字典要求 `record_key` 在**同一版本內唯一**、且**跨版本穩定**。
 *
 * - **不用月提繳工資金額**（例如 `29500`）：那是這一級**當期**的金額，而它每次調整都會變。
 *   實測歷年版本 `13335`：第 25 級在民國 110 年是 30300、113 年是 28800、115 年是 29500。
 *   拿金額當 key 的話，跨版本比對會說「30300 這一級不見了、29500 這一級是新的」，
 *   而真正發生的事是「第 25 級的金額變了」——後者才是版本比對要回答的問題。
 * - **不用列序**：理由與 `dataset_code=1` 的 `序號` 相同，政府增減級距就會整批位移。
 *   它的正確位置是 `sort_order`。
 * - 級數在這張表裡**只有一套**（不像 `1` 的級數在每種身分別內各自從 1 起算），
 *   因此單獨用它就已經唯一，不需要 `1` 那種複合鍵。
 *
 * 前綴 `grade-` 是刻意的：純數字的 key（`1`、`2`…）看起來像一個可以拿去排序或比大小的量，
 * 而它是一個代碼；加上前綴之後，`Number(record_key)` 這種寫法會當場壞掉而不是安靜地成立。
 *
 * ## `version_code` 不由這裡決定
 *
 * 版本代碼由生效日推導（`YYYY-MM`），規則對所有資料集共用，放在 `regulatory-sync-source.ts`。
 */
export const parseLaborPensionContributionWageGrades = (rawText: string): RegulatoryParseResult => {
  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (error) {
    // 政府端點在維護期間會回一頁 HTML，而 `JSON.parse` 的原訊息（`Unexpected token <`）
    // 對事後追查沒有幫助，因此補上「拿到的開頭長什麼樣」。
    return {
      ok: false,
      reason: `來源不是合法的 JSON（${error instanceof Error ? error.message : String(error)}）；開頭：${JSON.stringify(rawText.slice(0, 80))}`,
    }
  }

  if (!Array.isArray(payload)) {
    return { ok: false, reason: '來源 JSON 不是陣列，格式已與 2026-08 實測的形態不同' }
  }
  if (payload.length === 0) {
    // 空陣列會「成功」地產生一個沒有任何級距的版本，而 Payroll 查得到版本、查不到級距。
    return { ok: false, reason: '來源 JSON 是空陣列，沒有任何級距可以寫入' }
  }

  const lastIndex = payload.length - 1
  const records: ParsedRegulatoryRecord[] = []
  let effectiveFrom: string | null = null
  /** 上一級的級距上限，供「首尾相接」檢查。第一級之前沒有上一級。 */
  let previousRangeTo: string | null = null

  for (const [index, entry] of payload.entries()) {
    const position = `第 ${String(index + 1)} 列`
    if (!isPlainObject(entry)) {
      return { ok: false, reason: `${position}不是物件` }
    }

    const rawEffectiveFrom = readField(entry, FIELD.effectiveFrom)
    if (rawEffectiveFrom === null) {
      // 計畫 §7.2：這是「推導不出生效日」最直接的一種，一律失敗，不得以同步當天代替。
      return { ok: false, reason: `${position}缺少「${FIELD.effectiveFrom}」，無法推導版本生效日` }
    }

    const rocDate = parseRocCompactDate(rawEffectiveFrom)
    if (!rocDate.ok) {
      return { ok: false, reason: `${position}的「${FIELD.effectiveFrom}」無法轉換：${rocDate.reason}` }
    }

    if (effectiveFrom === null) {
      effectiveFrom = rocDate.value
    } else if (effectiveFrom !== rocDate.value) {
      return {
        ok: false,
        reason: `同一批資料出現兩個「${FIELD.effectiveFrom}」（${effectiveFrom} 與 ${rocDate.value}），無法推導唯一的版本生效日`,
      }
    }

    const grade = readField(entry, FIELD.grade)
    if (grade === null || !GRADE_PATTERN.test(grade)) {
      return { ok: false, reason: `${position}的「${FIELD.grade}」不是正整數：${JSON.stringify(grade)}` }
    }
    // 完整性檢查（一）：級數必須從 1 連號到 N，而且與列序一致。
    // 跳號代表政府刪掉了中間某一級；順序被打亂則代表這份資料的組織方式變了，
    // 而下面「首尾相接」的檢查是依列序做的，順序不對時它會報出一個看不懂的缺口。
    const expectedGrade = String(index + 1)
    if (grade !== expectedGrade) {
      return {
        ok: false,
        reason:
          `${position}的「${FIELD.grade}」是 ${grade}，期望 ${expectedGrade}：` +
          '級數必須從 1 連號到最後一級且與列序一致（跳號代表少了一級，順序不同代表格式已變）',
      }
    }

    const rangeText = readField(entry, FIELD.actualWage)
    if (rangeText === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.actualWage}」` }
    }
    // 單位是空字串：這一份的區間不帶「元」（`1501至3000`），與 `dataset_code=1` 不同。
    const range = parseAmountRange(rangeText, { unit: '', label: FIELD.actualWage })
    if (!range.ok) {
      return { ok: false, reason: `${position}的${range.reason}` }
    }

    // 完整性檢查（三）：開放的那一端只准出現在頭尾。
    const isFirst = index === 0
    const isLast = index === lastIndex
    if (isFirst !== (range.value.from === null)) {
      return {
        ok: false,
        reason: isFirst
          ? `${position}是第一級，「${FIELD.actualWage}」應該是「N以下」（沒有下限）：${JSON.stringify(rangeText)}`
          : `${position}不是第一級，「${FIELD.actualWage}」不該沒有下限：${JSON.stringify(rangeText)}`,
      }
    }
    if (isLast !== (range.value.to === null)) {
      return {
        ok: false,
        reason: isLast
          ? // 這正是「只抓到半截資料」的攔截點：被截斷的表最後一列會是一個普通的封閉級距，
            // 而月薪高於它的人從此查不到任何一級。
            `${position}是最後一級，「${FIELD.actualWage}」應該是「N以上」（沒有上限）：${JSON.stringify(rangeText)}` +
            '；若這是完整的資料，代表政府改了最高級的寫法'
          : `${position}不是最後一級，「${FIELD.actualWage}」不該沒有上限：${JSON.stringify(rangeText)}`,
      }
    }

    // 完整性檢查（二）：上一級的上限 ＋ 1 ＝ 這一級的下限。
    // 政府刪掉一級並且重新編號時，級數仍然連號，只有這一條會發現金額上的缺口。
    if (previousRangeTo !== null && range.value.from !== null) {
      const expectedFrom = BigInt(previousRangeTo) + 1n
      if (BigInt(range.value.from) !== expectedFrom) {
        return {
          ok: false,
          reason:
            `${position}的「${FIELD.actualWage}」下限是 ${range.value.from}，` +
            `但上一級的上限是 ${previousRangeTo}（期望 ${expectedFrom.toString()}）：` +
            '級距之間出現缺口或重疊，落在缺口裡的工資查不到任何一級',
        }
      }
    }
    previousRangeTo = range.value.to

    const rawContributionWage = readField(entry, FIELD.contributionWage)
    const contributionWage = rawContributionWage === null ? null : normalizeAmount(rawContributionWage)
    if (contributionWage === null || !INTEGER_AMOUNT_PATTERN.test(contributionWage)) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.contributionWage}」不是整數金額：${JSON.stringify(rawContributionWage)}`,
      }
    }

    const data: LaborPensionContributionWageGrade = {
      grade,
      actualWageRangeText: rangeText,
      actualWageFrom: range.value.from,
      actualWageTo: range.value.to,
      monthlyContributionWage: contributionWage,
      // 實測 62 列全是空字串；`readField` 已把空字串收斂成 `null`。
      // 一旦有值就是政府特地寫上去的法規內容，不能丟（理由見形狀定義）。
      remark: readField(entry, FIELD.remark),
    }

    records.push({
      recordKey: `grade-${grade}`,
      // `code` 是業務代碼（級數）。這個資料集沒有「身分別」那樣的顯示名稱，因此 `name` 是 null
      // ——硬塞一個「勞工退休金」之類的固定字串只會讓每一筆都長一樣，查詢時一點用都沒有。
      code: grade,
      name: null,
      rangeFrom: range.value.from,
      rangeTo: range.value.to,
      // 這一級實際用來提繳的法定基數。級距上下限在 `range_*`，這一欄是**結果**不是邊界
      //（最高一級的區間是「147901以上」而金額是 150000，兩者不是同一個數）。
      amount: contributionWage,
      // 本資料集不含費率：提繳率 6% 由《勞工退休金條例》直接規定，不在這張表上。
      rate: null,
      data,
      sortOrder: Number(grade),
    })
  }

  if (effectiveFrom === null) {
    // 走不到：上面已經擋掉空陣列，而每一列都必須有生效日。留著是因為型別上 `effectiveFrom`
    // 仍可能是 `null`，而用 `as` 收掉它等於把這個不變式從編譯器手上拿走（§2.2）。
    return { ok: false, reason: '無法從來源推導版本生效日' }
  }

  return { ok: true, effectiveFrom, records }
}
