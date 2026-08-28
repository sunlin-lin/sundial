/**
 * `dataset_code = 5` 健保費負擔金額表（有一定雇主之受僱者）的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `20246` 的 **CSV** 資源（計畫 §7.0 已實地查證，本次動工前又確認過一次）。
 * 實測的表頭與資料列：
 *
 * ```csv
 * 投保金額等級,月投保金額,本人負擔金額（負擔比率30%）,本人+1眷口負擔金額,本人+2眷口負擔金額,本人+3眷口負擔金額,投保單位負擔金額（負擔比率60%）,政府補助金額（補助比率10%）
 * 1,29500,458,916,1374,1832,1428,238
 * ```
 *
 * ## 19 個資源＝19 個歷史版本，回溯到民國 100 年 1 月
 *
 * 與 `dataset_code=2` 同一種形態（CSV ＋ 多資源），因此本檔也是
 * {@link RegulatoryVersionRecordsParser}（只解析內容），生效日由來源設定上的 `deriveEffectiveFrom`
 * 從資源說明推導（`115年1月有一定雇主受僱者健保費負擔金額表`）。
 *
 * **與 `2` 不同的是：這 19 個資源的說明全部都有年月**（實測），因此一次同步就能把民國 100 年 1 月
 * 以來的每一版補齊——計畫 §7.0 特別點名的那個好處，在這個資料集上是完整成立的。
 *
 * ## 這是「金額表」不是「費率表」（計畫 §3.1）
 *
 * 政府把每一級、每一種眷口數要繳多少錢都算好了，Payroll **查表**即可。
 * 自己乘費率再取捨會在邊界上與公告值差一塊錢，而那一塊錢在薪資單上是對不起來的實發金額。
 *
 * ## 完整性檢查
 *
 * 1. **表頭逐字比對**（在 `regulatory-csv.ts`）。這一條在這個資料集上不只是格式檢查：
 *    負擔比率寫在欄位名裡（`（負擔比率30%）`／`（負擔比率60%）`／`（補助比率10%）`），
 *    **比率改了就會在這裡當場失敗**——那是法規變更，而它在資料列上完全看不出來
 *    （每一格都還是一個合法的金額）。
 * 2. **眷口金額必須是本人金額的 2／3／4 倍**（實測 19 個版本、每一列都成立）。
 *    這個檢查不需要引進任何法規知識——四個數字都在同一列裡，對不起來就是欄位錯位或我們讀錯欄，
 *    而錯位之後每一個值單獨看都完全合法。
 * 3. **月投保金額必須嚴格遞增**。相等代表重複、變小代表順序或欄位變了。
 * 4. **級數頭尾錨定**：第一列是 1、最後一列等於列數（中間少一列時最後一列的級數會大於列數）。
 *
 * ### ⚠️ 第 4 條刻意**不**做逐列連號比對，理由是實測資料
 *
 * `107年1月` 那一份的**第 28 列的等級寫成 `8`**（2026-08 實測，其餘 18 份都正常）。
 * 那是政府自己的筆誤，而且是一份永遠不會再更新的歷史資源。做逐列連號比對的話，
 * 那一版**每天晚上都會失敗**，於是這個資料集永遠停在 `status=3`——而計畫對這種紅燈的判斷寫得很清楚：
 * 「那種紅燈很快就會被人放寬掉，於是這道檢查等於不存在」。
 *
 * 放行它是有代價的、也是有界的：等級**不是**我們的識別鍵（`record_key` 用月投保金額），
 * 因此那一格的值錯了不影響任何查詢；而「中間少了一列」——真正會讓某一群人查不到的失效模式——
 * 由頭尾錨定擋得住（少一列時 `最後一列的等級 ≠ 列數`）。
 *
 * ### 誠實地寫出這幾條擋不到什麼
 *
 * **尾端截斷偵測不到**：只抓到前 30 列時，等級 1…30、列數 30，頭尾錨定成立。
 * 這張表沒有「最高一級應該到哪裡」的內部依據——`dataset_code=2` 有（最高一級的區間必須是「N以上」），
 * 它沒有，每一列都是一個離散的金額。那一半的防線在排程同步之外：
 * `bun run check:live-sources` 會印出筆數，而筆數突然變少是看得見的（處置與 `dataset_code=4` 相同）。
 *
 * ## 數值一律 decimal 字串
 *
 * 全檔沒有一個 `Number(...)` 參與金額（§4.7）；倍數驗算走 `BigInt`。`Number` 只出現在 `sort_order`。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { INTEGER_AMOUNT_PATTERN, normalizeAmount } from './regulatory-amount.ts'
import { parseCsvTable, readCsvField, type CsvRow } from './regulatory-csv.ts'
import type { ParsedRegulatoryRecord, RegulatoryRecordsResult } from './regulatory-sync-model.ts'

/** `dataset_code=5` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type HealthInsurancePremiumShare = RegulatoryRecordData<5>

/**
 * 形狀的欄位 → 政府 CSV 的欄位名。**逐字寫出來**：欄位改名要當場失敗。
 *
 * `satisfies Record<keyof 形狀, string>` 讓兩邊**總對總**——這個資料集的八欄與政府的八欄
 * 一對一，沒有推導欄位，因此不需要 `dataset_code=2` 那種 `Exclude`。
 * 形狀多一欄、或這裡多一個形狀上沒有的 key，兩個方向都當場編譯不過。
 *
 * ⚠️ **宣告順序就是 CSV 的欄位順序**（{@link CSV_HEADER} 由 `Object.values` 推導）。
 */
const FIELD = {
  grade: '投保金額等級',
  monthlyInsuredAmount: '月投保金額',
  insuredShareAmount: '本人負擔金額（負擔比率30%）',
  insuredWithOneDependentAmount: '本人+1眷口負擔金額',
  insuredWithTwoDependentsAmount: '本人+2眷口負擔金額',
  insuredWithThreeDependentsAmount: '本人+3眷口負擔金額',
  employerShareAmount: '投保單位負擔金額（負擔比率60%）',
  governmentSubsidyAmount: '政府補助金額（補助比率10%）',
} as const satisfies Record<keyof HealthInsurancePremiumShare, string>

/** 期望的 CSV 表頭。**由 {@link FIELD} 推導，不另外列一份**（理由同 `dataset_code=2` 的解析器）。 */
const CSV_HEADER: readonly string[] = Object.values(FIELD)

/**
 * 眷口數 → 該欄的金額應該是本人金額的幾倍。
 *
 * `satisfies` 把三個眷口欄位釘在 {@link FIELD} 的 key 上：形狀改名時這裡當場編譯不過，
 * 而不是靜靜地少驗一欄。倍數本身是政府那一份的內部規律（實測 19 個版本全部成立），
 * **不是法規知識**——健保的眷口負擔以 3 口為上限，第 4 口起不再計收，因此政府只給到 +3。
 */
const DEPENDENT_MULTIPLES = {
  insuredWithOneDependentAmount: 2n,
  insuredWithTwoDependentsAmount: 3n,
  insuredWithThreeDependentsAmount: 4n,
} as const satisfies Partial<Record<keyof HealthInsurancePremiumShare, bigint>>

type DependentKey = keyof typeof DEPENDENT_MULTIPLES

/**
 * 要驗算的三個眷口欄位。由上面那份對照推導（形式比照 `regulatory-labor-insurance-salary.ts`
 * 的 `INSURED_CATEGORY_CODES`）：`Object.keys` 在型別上只回得出 `string[]`，
 * 而這個斷言的正確性由 `DEPENDENT_MULTIPLES` 的 key 集合本身保證。
 */
const DEPENDENT_KEYS = Object.keys(DEPENDENT_MULTIPLES) as readonly DependentKey[]

/** 級數：正整數字串。 */
const GRADE_PATTERN = /^\d+$/

/** 讀一個整數金額欄位（去逗號後必須是純整數）。六個金額欄位的處置完全一樣，寫六次只會分岔。 */
const readIntegerAmount = (
  row: CsvRow,
  field: string,
  position: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } => {
  const raw = readCsvField(row, field)
  const amount = raw === null ? null : normalizeAmount(raw)
  if (amount === null || !INTEGER_AMOUNT_PATTERN.test(amount)) {
    return { ok: false, reason: `${position}的「${field}」不是整數金額：${JSON.stringify(raw)}` }
  }
  return { ok: true, value: amount }
}

/**
 * 解析健保費負擔金額表（有一定雇主之受僱者）。
 *
 * @param rawText 政府 CSV 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 *
 * ## `record_key` 為什麼是 `amount-{月投保金額}`
 *
 * - **不能用 `投保金額等級`**：它是位置不是內容——基本工資一調，低薪的那幾級被刪掉，
 *   後面每一級的等級整批往前位移（實測第 1 級在民國 100 年是 17880、115 年是 29500）。
 *   而且政府自己在 107年1月 那一份把某一列的等級打錯了（見檔頭），拿它當識別鍵等於把
 *   `UNIQUE(dataset_version_id, record_key)` 建立在一個政府會打錯的欄位上。它的位置是 `code` 與 `sort_order`。
 * - **月投保金額是這一列的內容識別**：「投保金額 30300 這一級要繳多少」在每一個版本裡問的都是同一件事。
 * - **與 `dataset_code=2` 用同一種寫法是刻意的**：兩張表是同一組級距的兩面
 *   （`2` 回答「薪資落在第幾級、投保金額多少」，`5` 回答「那個投保金額要繳多少」），
 *   Payroll 從 `2` 拿到的月投保金額可以直接組成 `5` 的 `record_key`，中間不需要任何轉換表。
 * - **不用負擔金額當 key**：同一個金額可能出現在不同級（取捨之後會撞），而且它是這一列的**結果**。
 *
 * 前綴 `amount-` 是刻意的：純數字的 key 看起來像一個可以拿去比大小的量，而它是一個識別碼。
 *
 * ## `version_code` 不由這裡決定
 *
 * 版本代碼由生效日推導（`YYYY-MM`），規則對所有資料集共用，放在 `regulatory-sync-source.ts`。
 */
export const parseHealthInsurancePremiumShares = (rawText: string): RegulatoryRecordsResult => {
  const table = parseCsvTable(rawText, { header: CSV_HEADER, quoting: 'reject', label: '健保費負擔金額表' })
  if (!table.ok) return { ok: false, reason: table.reason }

  const { rows } = table
  const records: ParsedRegulatoryRecord[] = []
  const seenKeys = new Set<string>()
  /** 上一列的月投保金額，供「嚴格遞增」檢查。 */
  let previousInsuredAmount: string | null = null

  for (const [index, row] of rows.entries()) {
    const position = `第 ${String(index + 1)} 列`

    const grade = readCsvField(row, FIELD.grade)
    if (grade === null || !GRADE_PATTERN.test(grade)) {
      return { ok: false, reason: `${position}的「${FIELD.grade}」不是正整數：${JSON.stringify(grade)}` }
    }

    const insuredAmount = readIntegerAmount(row, FIELD.monthlyInsuredAmount, position)
    if (!insuredAmount.ok) return insuredAmount
    // 完整性檢查（三）：月投保金額必須嚴格遞增。
    if (previousInsuredAmount !== null && BigInt(insuredAmount.value) <= BigInt(previousInsuredAmount)) {
      return {
        ok: false,
        reason:
          `${position}的「${FIELD.monthlyInsuredAmount}」是 ${insuredAmount.value}，` +
          `未大於上一列的 ${previousInsuredAmount}：月投保金額必須由低到高嚴格遞增`,
      }
    }
    previousInsuredAmount = insuredAmount.value

    const insuredShare = readIntegerAmount(row, FIELD.insuredShareAmount, position)
    if (!insuredShare.ok) return insuredShare

    const withOne = readIntegerAmount(row, FIELD.insuredWithOneDependentAmount, position)
    if (!withOne.ok) return withOne
    const withTwo = readIntegerAmount(row, FIELD.insuredWithTwoDependentsAmount, position)
    if (!withTwo.ok) return withTwo
    const withThree = readIntegerAmount(row, FIELD.insuredWithThreeDependentsAmount, position)
    if (!withThree.ok) return withThree

    // 完整性檢查（二）：眷口金額 ＝ 本人金額 × 2／3／4。
    const dependentAmounts: Record<DependentKey, string> = {
      insuredWithOneDependentAmount: withOne.value,
      insuredWithTwoDependentsAmount: withTwo.value,
      insuredWithThreeDependentsAmount: withThree.value,
    }
    for (const key of DEPENDENT_KEYS) {
      const multiple = DEPENDENT_MULTIPLES[key]
      const actual = dependentAmounts[key]
      const expected = BigInt(insuredShare.value) * multiple
      if (BigInt(actual) !== expected) {
        return {
          ok: false,
          reason:
            `${position}的「${FIELD[key]}」是 ${actual}，` +
            `但「${FIELD.insuredShareAmount}」${insuredShare.value} 的 ${multiple.toString()} 倍是 ${expected.toString()}：` +
            '眷口負擔金額是本人金額的整數倍，對不起來代表欄位錯位或某一格打錯',
        }
      }
    }

    const employerShare = readIntegerAmount(row, FIELD.employerShareAmount, position)
    if (!employerShare.ok) return employerShare
    const governmentSubsidy = readIntegerAmount(row, FIELD.governmentSubsidyAmount, position)
    if (!governmentSubsidy.ok) return governmentSubsidy

    const recordKey = `amount-${insuredAmount.value}`
    if (seenKeys.has(recordKey)) {
      return { ok: false, reason: `${position}的 record_key 重複：${recordKey}` }
    }
    seenKeys.add(recordKey)

    const data: HealthInsurancePremiumShare = {
      grade,
      monthlyInsuredAmount: insuredAmount.value,
      insuredShareAmount: insuredShare.value,
      insuredWithOneDependentAmount: withOne.value,
      insuredWithTwoDependentsAmount: withTwo.value,
      insuredWithThreeDependentsAmount: withThree.value,
      employerShareAmount: employerShare.value,
      governmentSubsidyAmount: governmentSubsidy.value,
    }

    records.push({
      recordKey,
      // `code` 是業務代碼（等級）。這張表沒有顯示名稱，硬塞一個固定字串只會讓每一筆長得一樣。
      code: grade,
      name: null,
      // 這不是級距表：每一列對應一個**確切的**月投保金額，不是一段區間
      //（薪資落在哪一級是 `dataset_code=2` 的分級表在回答的問題）。
      // 填一個 `from = to = 月投保金額` 的假區間會讓級距查詢寫得出來、而且看起來成立。
      rangeFrom: null,
      rangeTo: null,
      // 計算基礎值（月投保金額），與 `dataset_code=2` 的 `amount` 是同一個值。
      // 六個負擔金額在 `data` 裡：`amount` 只有一欄，挑其中一個會讓另外五個看起來不存在。
      amount: insuredAmount.value,
      // 負擔比率（30%／60%／10%）寫在**表頭**裡，不是資料欄；抄一份到這裡會產生第二份真相，
      // 而兩者不一致時沒有任何地方會報錯。表頭逐字比對已經在守它（見檔頭）。
      rate: null,
      data,
      sortOrder: Number(grade),
    })
  }

  // 完整性檢查（四）：級數頭尾錨定。**刻意不是逐列連號**，理由見檔頭（政府在 107年1月 打錯過一格）。
  const firstGrade = records[0]?.code
  const lastGrade = records[records.length - 1]?.code
  if (firstGrade !== '1' || lastGrade !== String(rows.length)) {
    return {
      ok: false,
      reason:
        `「${FIELD.grade}」的頭尾對不上：第一列是 ${String(firstGrade)}（期望 1）、` +
        `最後一列是 ${String(lastGrade)}（期望 ${String(rows.length)}＝列數）：中間少了一列`,
    }
  }

  return { ok: true, records }
}
