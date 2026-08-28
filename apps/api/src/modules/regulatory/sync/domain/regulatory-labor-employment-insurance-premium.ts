/**
 * `dataset_code = 4` 勞就保保險費分擔金額表的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `6259` 的 JSON 資源（計畫 §7.0 已實地查證，本次同步前又確認過一次）。
 * 實測回傳是一個陣列，28 列，每一列長這樣：
 *
 * ```json
 * {"序號":"1","勞保普通費率":"11.5%","就保費率":"1%","投保薪資":"11100",
 *  "勞工應負擔保費金額":"277","單位應負擔保費金額":"972"}
 * ```
 *
 * ## ⚠️ 生效日在**資源說明**裡，而且它是「這張金額表」的適用日
 *
 * 資源內容裡**一個日期欄位都沒有**（JSON／CSV／XML 三種格式都確認過），生效日只寫在
 * metadata 的 `resourceDescription`：`…保險費分擔金額表(自115年1月1日起適用)`。
 * 因此本解析器要用 {@link RegulatoryParseContext}，讀不到或讀不懂就整批失敗（計畫 §7.2）。
 *
 * **這個日期是「分擔金額表」的適用日，不是勞保普通事故費率 11.5% 的生效日。**
 * 11.5% 自民國 **114** 年 1 月 1 日起生效，而這張表的資源說明寫的是 **115** 年 1 月 1 日。
 * 計畫 §3.1 把這件事記成一個坑：本格原本設計成「勞保費率」，那樣的話照資源說明建版本會讓
 * 114 年整年的結算抓到錯的版本邊界——而每一級的金額都合法，薪資單上看不出任何異常。
 * 改成金額表之後坑就消失了，因為版本邊界問的正是「這張金額表從哪天開始適用」。
 *
 * **下一個人要注意的是反方向**：不要拿這個資料集的 `effective_from` 去回答
 * 「勞保費率從哪天開始是 11.5%」。{@link FIELD.laborRate} 只是政府在每一列上重複標註的計算依據，
 * 它的生效日不在這份資料裡，這裡也推導不出來。
 *
 * ## 完整性檢查：這個資料集**沒有**「身分別」那種封閉清單的對應物，明說而不硬湊
 *
 * `dataset_code=1` 靠「四種投保身分別必須齊全」、`6` 靠「19 種大分類必須齊全」擋住
 * 「政府刪掉一整類」。這張表的每一列只是一個投保薪資級距，**沒有任何維度是封閉的**：
 * 投保薪資的級距數會隨基本工資調整而增減（低薪的幾級會被刪掉、高薪端會加），
 * 寫死任何一份期望清單都會在下一次調整時過期，而過期的症狀是「每年例行調整都同步失敗」
 * ——那種紅燈很快就會被人放寬掉，於是這道檢查等於不存在。
 *
 * 因此這裡守的是三件**不需要清單**也成立的事：
 *
 * 1. **兩個費率整批一致**。同一個版本只能有一組費率；混進兩組代表這個檔案同時裝了兩期的資料，
 *    而挑其中一組就是推測值（處置與「整批生效日必須一致」逐字相同）。
 * 2. **序號必須從 1 連號到 N**，且與列序一致。中間跳號代表少了一級。
 * 3. **投保薪資必須嚴格遞增**。這一條比第 2 條強：政府刪掉中間一級並重新編號時序號仍然連號，
 *    只有金額的排列會露出破綻（不過**中間的缺口本身仍然偵測不到**，見下）。
 *
 * **誠實地寫出這三條擋不到什麼**：政府若從頭或從尾少給幾級（或中間刪掉一級並重新編號且金額
 * 仍然遞增），這裡不會發現——沒有「上限應該是多少」的外部依據可比對。
 * `dataset_code=3` 有這個依據（級距首尾相接，最高一級必須是開放區間），這張表沒有：
 * 它的每一列都是離散的金額，級與級之間本來就不連續（11100 的下一級是 12540）。
 * 那一半的防線在排程同步之外：`bun run check:live-sources` 會印出筆數，而筆數突然變少是看得見的。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { INTEGER_AMOUNT_PATTERN, normalizeAmount, percentToRate } from './regulatory-amount.ts'
import { parseRocEffectiveDateFromText } from './regulatory-roc-date.ts'
import type { ParsedRegulatoryRecord, RegulatoryParseContext, RegulatoryParseResult } from './regulatory-sync-model.ts'

/** `dataset_code=4` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type LaborEmploymentInsurancePremiumShare = RegulatoryRecordData<4>

/** 政府那一份的六個欄位名。**逐字寫出來**：欄位改名要在這裡當場失敗，不要靜靜地讀到 `undefined`。 */
const FIELD = {
  sequence: '序號',
  laborRate: '勞保普通費率',
  employmentRate: '就保費率',
  insuredSalary: '投保薪資',
  employeeShare: '勞工應負擔保費金額',
  employerShare: '單位應負擔保費金額',
} as const

/** 序號：正整數字串。 */
const SEQUENCE_PATTERN = /^\d+$/

/** 從政府那一列取一個字串欄位。**缺欄位與空字串都算缺**——後者在 CSV 轉 JSON 時很常見。 */
const readField = (row: Record<string, unknown>, field: string): string | null => {
  const value = row[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 讀一個整數金額欄位（去逗號後必須是純整數）。三個金額欄位的處置完全一樣，寫三次只會分岔。 */
const readIntegerAmount = (
  row: Record<string, unknown>,
  field: string,
  position: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } => {
  const raw = readField(row, field)
  const amount = raw === null ? null : normalizeAmount(raw)
  if (amount === null || !INTEGER_AMOUNT_PATTERN.test(amount)) {
    return { ok: false, reason: `${position}的「${field}」不是整數金額：${JSON.stringify(raw)}` }
  }
  return { ok: true, value: amount }
}

/**
 * 解析勞就保保險費分擔金額表。
 *
 * @param rawText 政府 JSON 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 * @param context 本次 resource discovery 的產物。**生效日唯一的來源**，見檔頭。
 *
 * ## `record_key` 為什麼是 `salary-{投保薪資}`
 *
 * - **不能用 `序號`**：它是列序（1–28），而這張表的列數每年都會變——基本工資一調，
 *   低薪的那幾級被刪掉、後面每一列的序號整批往前位移。位移不會有任何錯誤，
 *   只會讓「第 3 列」在兩個版本間指向不同的投保薪資。它的正確位置是 `sort_order`。
 * - **投保薪資是這一列的內容識別**：「投保薪資 24000 這一級要繳多少」在每一個版本裡問的都是同一件事，
 *   因此拿它當 key，跨版本比對得到的正是「這一級的分擔金額變了多少」。
 *   某一級因為基本工資調高而消失時，比對會如實顯示它不見了——那是對的，它真的不見了。
 * - **不用金額當 key**（勞工應負擔保費）：同一個金額可能出現在不同級（取捨之後會撞），
 *   而且它是這一列的**結果**，不是識別。
 *
 * 前綴 `salary-` 是刻意的：純數字的 key 看起來像一個可以拿去比大小的量，而它是一個識別碼。
 */
export const parseLaborEmploymentInsurancePremiumShares = (
  rawText: string,
  context: RegulatoryParseContext,
): RegulatoryParseResult => {
  // 生效日先算：讀不到資源說明時，後面 28 列全部解析完也沒有意義（計畫 §7.2）。
  // **「政府這次沒寫」與「寫了但讀不懂」分成兩句話**：前者重跑沒有用，後者要有人去看措辭改成什麼。
  if (context.resourceDescription === null) {
    return {
      ok: false,
      reason:
        'metadata 沒有給資源說明，而本資料集的生效日只寫在資源說明裡（資源內容沒有任何日期欄位），' +
        '無法推導版本生效日',
    }
  }
  const effective = parseRocEffectiveDateFromText(context.resourceDescription, '資源說明')
  if (!effective.ok) return { ok: false, reason: effective.reason }
  const effectiveFrom = effective.value

  let payload: unknown
  try {
    payload = JSON.parse(rawText)
  } catch (error) {
    // 政府端點在維護期間會回一頁 HTML，而 `JSON.parse` 的原訊息對事後追查沒有幫助。
    return {
      ok: false,
      reason: `來源不是合法的 JSON（${error instanceof Error ? error.message : String(error)}）；開頭：${JSON.stringify(rawText.slice(0, 80))}`,
    }
  }

  if (!Array.isArray(payload)) {
    return { ok: false, reason: '來源 JSON 不是陣列，格式已與 2026-08 實測的形態不同' }
  }
  if (payload.length === 0) {
    // 空陣列會「成功」地產生一個沒有任何級距的版本，而 Payroll 查得到版本、查不到金額。
    return { ok: false, reason: '來源 JSON 是空陣列，沒有任何級距可以寫入' }
  }

  const records: ParsedRegulatoryRecord[] = []
  /** 整批共用的那一組費率。第一列決定，其餘每一列都要對得上（完整性檢查一）。 */
  let batchRates: { readonly labor: string; readonly employment: string } | null = null
  /** 上一列的投保薪資，供「嚴格遞增」檢查。 */
  let previousInsuredSalary: string | null = null

  for (const [index, entry] of payload.entries()) {
    const position = `第 ${String(index + 1)} 列`
    if (!isPlainObject(entry)) {
      return { ok: false, reason: `${position}不是物件` }
    }

    const rawSequence = readField(entry, FIELD.sequence)
    if (rawSequence === null || !SEQUENCE_PATTERN.test(rawSequence)) {
      return { ok: false, reason: `${position}的「${FIELD.sequence}」不是正整數：${JSON.stringify(rawSequence)}` }
    }
    // 完整性檢查（二）：序號必須從 1 連號到 N，而且與列序一致。
    const expectedSequence = String(index + 1)
    if (rawSequence !== expectedSequence) {
      return {
        ok: false,
        reason:
          `${position}的「${FIELD.sequence}」是 ${rawSequence}，期望 ${expectedSequence}：` +
          '序號必須從 1 連號到最後一列且與列序一致（跳號代表少了一級）',
      }
    }

    const rawLaborRate = readField(entry, FIELD.laborRate)
    if (rawLaborRate === null) return { ok: false, reason: `${position}缺少「${FIELD.laborRate}」` }
    const laborRate = percentToRate(rawLaborRate, { suffix: '%', label: `「${FIELD.laborRate}」` })
    if (!laborRate.ok) return { ok: false, reason: `${position}的${laborRate.reason}` }

    const rawEmploymentRate = readField(entry, FIELD.employmentRate)
    if (rawEmploymentRate === null) return { ok: false, reason: `${position}缺少「${FIELD.employmentRate}」` }
    const employmentRate = percentToRate(rawEmploymentRate, { suffix: '%', label: `「${FIELD.employmentRate}」` })
    if (!employmentRate.ok) return { ok: false, reason: `${position}的${employmentRate.reason}` }

    // 完整性檢查（一）：整批只能有一組費率。混進兩組代表這個檔案同時裝了兩期的資料，
    // 而挑其中一組正是計畫 §7.2 禁止的推測值——處置與「整批生效日必須一致」逐字相同。
    if (batchRates === null) {
      batchRates = { labor: laborRate.value, employment: employmentRate.value }
    } else if (batchRates.labor !== laborRate.value || batchRates.employment !== employmentRate.value) {
      return {
        ok: false,
        reason:
          `${position}的費率（${FIELD.laborRate} ${laborRate.value}／${FIELD.employmentRate} ${employmentRate.value}）` +
          `與前面幾列（${batchRates.labor}／${batchRates.employment}）不同：` +
          '同一個版本只能有一組費率',
      }
    }

    const insuredSalary = readIntegerAmount(entry, FIELD.insuredSalary, position)
    if (!insuredSalary.ok) return insuredSalary
    // 完整性檢查（三）：投保薪資必須嚴格遞增。相等代表重複、變小代表順序或欄位變了。
    if (previousInsuredSalary !== null && BigInt(insuredSalary.value) <= BigInt(previousInsuredSalary)) {
      return {
        ok: false,
        reason:
          `${position}的「${FIELD.insuredSalary}」是 ${insuredSalary.value}，` +
          `未大於上一列的 ${previousInsuredSalary}：投保薪資必須由低到高嚴格遞增`,
      }
    }
    previousInsuredSalary = insuredSalary.value

    const employeeShare = readIntegerAmount(entry, FIELD.employeeShare, position)
    if (!employeeShare.ok) return employeeShare
    const employerShare = readIntegerAmount(entry, FIELD.employerShare, position)
    if (!employerShare.ok) return employerShare

    const data: LaborEmploymentInsurancePremiumShare = {
      insuredSalary: insuredSalary.value,
      laborInsuranceRate: laborRate.value,
      employmentInsuranceRate: employmentRate.value,
      employeeShareAmount: employeeShare.value,
      employerShareAmount: employerShare.value,
    }

    records.push({
      recordKey: `salary-${insuredSalary.value}`,
      // 這張表沒有「級數」那樣的業務代碼欄（`序號` 是列序，它的位置是 `sort_order`），
      // 也沒有顯示名稱。硬塞值只會讓每一筆長得一樣，查詢時一點用都沒有。
      code: null,
      name: null,
      // 這不是級距表：每一列對應一個**確切的**投保薪資，不是一段區間
      //（工資落在哪一級是 `dataset_code=1` 的分級表在回答的問題）。
      // 填一個 `from = to = 投保薪資` 的假區間會讓級距查詢寫得出來、而且看起來成立。
      rangeFrom: null,
      rangeTo: null,
      // 計算基礎值（投保薪資），與 `dataset_code=1` 的 `amount` 同一個概念。
      // 兩個分擔金額在 `data` 裡：`amount` 只有一欄，挑其中一個會讓另一個看起來不存在。
      amount: insuredSalary.value,
      // 兩個費率同理：`rate` 只有一欄，填勞保費率會讓就保那 1% 在 `records` 這一層消失，
      // 而「保費 = 投保薪資 × rate」這種看起來理所當然的算法會少算就業保險。
      rate: null,
      data,
      sortOrder: Number(rawSequence),
    })
  }

  return { ok: true, effectiveFrom, records }
}
