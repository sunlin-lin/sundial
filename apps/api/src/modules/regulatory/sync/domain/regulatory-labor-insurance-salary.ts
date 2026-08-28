/**
 * `dataset_code = 1` 勞工保險投保薪資分級表的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `6258` 的 JSON 資源（計畫 §7.0 已實地查證，本次同步前又確認過一次）。
 * 實測回傳是一個陣列，每一列長這樣：
 *
 * ```json
 * {"適用起日":"1150101","序號":"1","身分別":"一般勞工","投保薪資等級":"1",
 *  "月薪資總額":"29500元以下","月投保薪資":"29500"}
 * ```
 *
 * ## 這支解析器只有兩種結局：整批成功，或整批失敗
 *
 * 沒有「解析出 90 筆、有 7 筆看不懂就跳過」這條路。跳過的那幾筆若是新的級距，
 * 少了它們的分級表在 Payroll 眼中是一張**完整而錯誤**的表——每一級的金額都對，只是少了幾級，
 * 於是落在那幾級的人被算到隔壁級距，保費差幾百塊，薪資單上完全看不出異常。
 *
 * ## 身分別的封閉性是雙向的：多一種失敗，**少一種也失敗**
 *
 * 政府新增一類投保身分 → 未知身分別 → 失敗；政府刪掉一類 → 完整性檢查 → 失敗。
 * 兩個方向都是法規變更，處置必須一致——只擋一邊的話，「少一類」會是一次完全成功的同步，
 * 而那一類人的級距從此查不到，薪資單上是一個沒有勞保扣款、金額完全合理的結果。
 * 落點在 {@link INSURED_CATEGORY_NAMES}（總對總地綁在形狀定義上）與函式尾端的完整性檢查。
 *
 * ## 生效日：`適用起日` 是唯一來源，而且整批必須一致
 *
 * 計畫 §7.2 是硬規則：**推導不出生效日一律失敗，不得以同步當天、上一版生效日或任何推測值 fallback。**
 * 落到這支解析器上是三條檢查：
 *
 * 1. 每一列都要有 `適用起日`（缺一列即失敗）；
 * 2. 每一列的值都要能轉成合法的西元日期（見 `regulatory-roc-date.ts`）；
 * 3. **整批的值必須完全相同**——政府哪天在同一個檔案裡混進兩個生效日時，
 *    「這一版從哪天開始生效」就沒有唯一答案，而挑其中一個正是「推測值」。
 *
 * 這支函式的簽章裡**沒有時間**（沒有 clock、沒有 `Date`），因此上面那個 fallback 寫不出來。
 *
 * ## 數值一律 decimal 字串，全程沒有一個 `Number(...)` 參與金額
 *
 * §4.7 逐字點名這個場景：級距在邊界值上會選錯級距，錯的是法定金額。本檔的 `Number` 只出現在
 * `序號`（列序，不是金額）上；金額從政府那串字串進來、以字串出去，中間只做去逗號
 *（去逗號、句型判讀與比大小都在 `regulatory-amount.ts`，`dataset_code=3` 用的是同一份）。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import {
  INTEGER_AMOUNT_PATTERN,
  normalizeAmount,
  parseAmountRange,
  type AmountRangeResult,
} from './regulatory-amount.ts'
import type { ParsedRegulatoryRecord, RegulatoryParseResult } from './regulatory-sync-model.ts'
import { parseRocCompactDate } from './regulatory-roc-date.ts'

/** `dataset_code=1` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type LaborInsuranceSalaryGrade = RegulatoryRecordData<1>

type InsuredCategoryCode = LaborInsuranceSalaryGrade['insuredCategoryCode']

/**
 * 我們的代碼 → 政府原文的 `身分別`。
 *
 * **這份對照是封閉的，而且兩個方向都封閉：**
 *
 * - 出現沒列在這裡的身分別（政府**新增**一類）→ 整批失敗。新增一種投保身分是法規變更，
 *   Payroll 必須知道它存在。放行未知值的作法（例如原文照抄當代碼）會讓那一類人的級距
 *   悄悄地不被任何一段結算邏輯認得，而沒有任何地方會報錯（見形狀定義的說明）。
 * - 這裡列著、來源卻一筆都沒有（政府**刪掉**一類）→ 整批失敗，見
 *   {@link parseLaborInsuranceSalaryGrades} 的完整性檢查。
 *
 * **key 是我們的代碼而不是政府原文，這是刻意的**（前一版是反過來寫的）：
 * `satisfies Record<InsuredCategoryCode, string>` 讓這份對照與形狀定義上那個字面值聯集
 * **總對總**地綁在一起——形狀多一個字面值時這裡缺 key、少一個時這裡多 key，兩個方向都當場編譯不過。
 * 寫成「原文 → 代碼」時，型別只擋得住值不合法，擋不住「漏了一整種」，
 * 而「期望有哪幾種」正是完整性檢查唯一需要的那份清單——它因此不必、也不得再抄一份。
 *
 * 四個值來自 2026-08 實測的完整清單（97 列，四種身分別）。
 */
const INSURED_CATEGORY_NAMES = {
  general: '一般勞工',
  shelteredDisabled: '庇護性身心障礙者',
  partTime: '部分工時勞工',
  vocationalTrainee: '職訓機構受訓者',
} as const satisfies Record<InsuredCategoryCode, string>

/**
 * 全部身分別代碼。**這一份就是完整性檢查的期望清單**，由上面那個總對總的對照表推導。
 *
 * `Object.keys(...) as ...` 的形式比照 `datasets/domain/regulatory-dataset-code.ts` 的
 * `REGULATORY_DATASET_CODES`：`Object.keys` 在型別上只回得出 `string[]`，
 * 而這個斷言的正確性由上一段的 `satisfies` 保證（key 集合就是那個聯集本身）。
 */
const INSURED_CATEGORY_CODES = Object.keys(INSURED_CATEGORY_NAMES) as readonly InsuredCategoryCode[]

/**
 * 政府原文的 `身分別` → 我們的代碼；不在對照表裡時是 `undefined`（＝未知身分別，整批失敗）。
 *
 * 逐項比對而不是建一份反向 map：對照表固定四項、來源不到一百列，成本可以忽略，
 * 而反向 map 需要一次 `Object.fromEntries` ＋ 型別斷言，多出來的那一步沒有換到任何東西。
 */
const toInsuredCategoryCode = (categoryName: string): InsuredCategoryCode | undefined =>
  INSURED_CATEGORY_CODES.find((code) => INSURED_CATEGORY_NAMES[code] === categoryName)

/** 政府那一份的六個欄位名。**逐字寫出來**：欄位改名要在這裡當場失敗，不要靜靜地讀到 `undefined`。 */
const FIELD = {
  effectiveFrom: '適用起日',
  sequence: '序號',
  category: '身分別',
  grade: '投保薪資等級',
  salaryRange: '月薪資總額',
  insuredSalary: '月投保薪資',
} as const

/** 級數：正整數字串。 */
const GRADE_PATTERN = /^\d+$/

/**
 * 「月薪資總額」的中文區間字串 → 上下限。
 *
 * **句型判讀在 `regulatory-amount.ts`，本檔只釘住「這一欄長什麼樣」**：單位是「元」、欄位名是
 * 「月薪資總額」。`dataset_code=3` 的同一種區間不帶「元」（`1501至3000`），兩邊抄成兩份的話，
 * 其中一份哪天為了讓新格式通過而放寬 pattern，另一份不會跟著鬆——同一個概念會有兩種嚴格度。
 *
 * 這個薄包裝保留下來（而不是叫呼叫端直接用共用函式）有兩個作用：它是本資料集
 * 「單位是元」這個事實的唯一落點，而且它是既有測試的對象。
 */
export const parseMonthlySalaryRange = (rangeText: string): AmountRangeResult =>
  parseAmountRange(rangeText, { unit: '元', label: '月薪資總額' })

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
 * 解析勞工保險投保薪資分級表。
 *
 * @param rawText 政府 JSON 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 *
 * ## `record_key` 為什麼是「身分別代碼-級數」
 *
 * 資料字典要求 `record_key` 在**同一版本內唯一**、且**跨版本穩定**（同一筆法規內容在不同版本
 * 之間應該得到同一個 key，這樣「這一級在新版變成多少」才比對得出來）。
 *
 * - **不能用 `序號`**：它是全表的列序（1–97），政府新增一種身分別就會讓後面每一列的序號整批位移，
 *   而位移不會有任何錯誤——只會讓「第 50 級」在兩個版本間指向不同的東西。它的正確位置是
 *   `sort_order`（政府資料的原始列序）。
 * - **不能只用 `投保薪資等級`**：級數在**每一種身分別內各自從 1 起算**（實測四種身分別各有
 *   11／32／28／26 級），單獨用它會在同一個版本內撞成四份，直接違反 `UNIQUE(dataset_version_id, record_key)`。
 * - 「身分別 ＋ 級數」既唯一又穩定，而且正是資料字典舉的例子（「投保薪資的第 5 級」）。
 *   身分別用**我們的代碼**而不是中文原文：原文是政府的顯示字串，改一個字（例如加上括號附註）
 *   就會讓整批 key 變成新的，於是跨版本比對整個失效。
 *
 * ## `version_code` 不由這裡決定
 *
 * 版本代碼由生效日推導（`YYYY-MM`），規則對所有資料集共用，因此放在 `regulatory-sync-source.ts`
 * ——每個解析器各自決定一次的話，同一個概念會有九種寫法。
 */
export const parseLaborInsuranceSalaryGrades = (rawText: string): RegulatoryParseResult => {
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
    // 空陣列會「成功」地產生一個沒有任何級距的版本，而 Payroll 查得到版本、查不到級距
    // ——那比同步失敗難查得多。
    return { ok: false, reason: '來源 JSON 是空陣列，沒有任何級距可以寫入' }
  }

  const records: ParsedRegulatoryRecord[] = []
  const seenKeys = new Set<string>()
  /** 這一批實際出現過的身分別。收完之後要與 {@link INSURED_CATEGORY_CODES} 比對，見迴圈之後。 */
  const seenCategories = new Set<InsuredCategoryCode>()
  let effectiveFrom: string | null = null

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

    const categoryName = readField(entry, FIELD.category)
    if (categoryName === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.category}」` }
    }
    const insuredCategoryCode = toInsuredCategoryCode(categoryName)
    if (insuredCategoryCode === undefined) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.category}」是未知的身分別：${JSON.stringify(categoryName)}（新增身分別屬法規變更，需先擴充形狀定義）`,
      }
    }

    const grade = readField(entry, FIELD.grade)
    if (grade === null || !GRADE_PATTERN.test(grade)) {
      return { ok: false, reason: `${position}的「${FIELD.grade}」不是正整數：${JSON.stringify(grade)}` }
    }

    const rangeText = readField(entry, FIELD.salaryRange)
    if (rangeText === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.salaryRange}」` }
    }
    const range = parseMonthlySalaryRange(rangeText)
    if (!range.ok) {
      return { ok: false, reason: `${position}的「${FIELD.salaryRange}」${range.reason}` }
    }

    const rawInsuredSalary = readField(entry, FIELD.insuredSalary)
    const insuredSalary = rawInsuredSalary === null ? null : normalizeAmount(rawInsuredSalary)
    if (insuredSalary === null || !INTEGER_AMOUNT_PATTERN.test(insuredSalary)) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.insuredSalary}」不是整數金額：${JSON.stringify(rawInsuredSalary)}`,
      }
    }

    const rawSequence = readField(entry, FIELD.sequence)
    if (rawSequence === null || !GRADE_PATTERN.test(rawSequence)) {
      return { ok: false, reason: `${position}的「${FIELD.sequence}」不是正整數：${JSON.stringify(rawSequence)}` }
    }

    const recordKey = `${insuredCategoryCode}-${grade}`
    if (seenKeys.has(recordKey)) {
      // 撞 key 代表同一種身分別出現了兩次同一級。放行的話會在寫入時撞
      // `UNIQUE(dataset_version_id, record_key)`，而那時的錯誤訊息是一句 SQL 唯一鍵違反，
      // 看不出是哪一列、也看不出成因。
      return { ok: false, reason: `${position}的 record_key 重複：${recordKey}` }
    }
    seenKeys.add(recordKey)
    seenCategories.add(insuredCategoryCode)

    const data: LaborInsuranceSalaryGrade = {
      insuredCategoryCode,
      insuredCategoryName: categoryName,
      grade,
      monthlySalaryRangeText: rangeText,
      monthlySalaryFrom: range.value.from,
      monthlySalaryTo: range.value.to,
      monthlyInsuredSalary: insuredSalary,
    }

    records.push({
      recordKey,
      // `code` 是業務代碼（級數），`name` 是顯示名稱（身分別原文）——與資料字典對這兩欄的定義一致。
      code: grade,
      name: categoryName,
      rangeFrom: range.value.from,
      rangeTo: range.value.to,
      // 這一級實際用來計算保費的金額。級距上下限在 `range_*`，這一欄是**結果**不是邊界。
      amount: insuredSalary,
      // 本資料集不含費率（勞保費率在 `dataset_code=4` 的分擔金額表，計畫 §3.1）。
      rate: null,
      data,
      sortOrder: Number(rawSequence),
    })
  }

  // 四種身分別必須全部出現，缺一種即整批失敗。
  //
  // **這一條與上面「未知身分別即失敗」是同一件事的另一個方向**，兩邊的處置必須一致：
  // 政府**新增**一類已經會讓同步失敗（那是法規變更，Payroll 必須知道它存在），
  // 那麼政府**刪掉**一類就不能反而完全成功——同一件事的兩個方向處置不一致，那本身就是缺陷。
  //
  // 少了一類的後果比「同步失敗」嚴重得多：解析成功、版本照樣寫進去、每一級的金額都對，
  // 只是那一類人**查不到任何級距**。而查不到不會拋錯——薪資結算會產出一張沒有勞保扣款、
  // 金額完全合理的薪資單，要等到有人拿投保明細去核對才會發現。
  // 寧可同步失敗（`status=3` ＋ `error_message`），讓人去看那一行。
  //
  // 這一條同時也是「只抓到半截資料」的攔截點：被截斷的回應必然會少掉排在後面的那幾類，
  // 因此不需要另外再訂一個「至少幾筆」的下限——那種下限每次政府調整級距都會過期。
  const missingCategories = INSURED_CATEGORY_CODES.filter((code) => !seenCategories.has(code))
  if (missingCategories.length > 0) {
    // 訊息要寫出**少了哪一種**（原文 ＋ 代碼）而不是只說「不完整」：這一句會原樣進
    // `regulatory_sync_logs.error_message`，而事後看紀錄的人要能當場判斷這是政府廢止了那一類
    //（法規變更，要有人去確認並擴充形狀定義），還是我們只抓到半截資料（重跑即可）。
    const describe = (code: InsuredCategoryCode): string => `${INSURED_CATEGORY_NAMES[code]}（${code}）`
    return {
      ok: false,
      reason:
        `來源缺少投保身分別：${missingCategories.map(describe).join('、')}` +
        `；本批只有：${[...seenCategories].map(describe).join('、')}`,
    }
  }

  if (effectiveFrom === null) {
    // 走不到：上面已經擋掉空陣列，而每一列都必須有生效日。留著是因為型別上 `effectiveFrom`
    // 仍可能是 `null`，而用 `as` 收掉它等於把這個不變式從編譯器手上拿走（§2.2）。
    return { ok: false, reason: '無法從來源推導版本生效日' }
  }

  return { ok: true, effectiveFrom, records }
}
