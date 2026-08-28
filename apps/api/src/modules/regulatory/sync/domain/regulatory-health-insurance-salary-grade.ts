/**
 * `dataset_code = 2` 全民健康保險投保金額分級表的解析器（零 IO 純函式，§0.1）。
 *
 * 來源：data.gov.tw `20251` 的 **CSV** 資源（計畫 §7.0 已實地查證，本次動工前又確認過一次）。
 * 實測的表頭與資料列：
 *
 * ```csv
 * 組別級距,投保等級,月投保金額（元）,實際薪資月額（元）
 * 第一組級距1200元,1,29500,29500以下
 * 第二組級距1500元,2,30300,29501-30300
 * 第十二組級距10000元,58,313000,303001以上
 * ```
 *
 * ## 與前四個資料集不同的兩件事
 *
 * 1. **格式是 CSV，不是 JSON**：健保署把資源託管在自己那裡，`20251` 的 16 個資源全部只有 CSV
 *    一種格式（實測）。表頭與欄位數的比對在 `regulatory-csv.ts`，本檔照舊用 `FIELD` 逐字寫欄位名。
 * 2. **一個資料集底下有 16 個資源，每一個是一個年度版本**：因此本檔是
 *    {@link RegulatoryVersionRecordsParser}（只解析內容），生效日由來源設定上的
 *    `deriveEffectiveFrom` 從**資源說明**推導。同一個答案只有一個出處，理由見那個型別的說明。
 *
 * ## 生效日不在這個檔案裡，而那是刻意的
 *
 * 資源內容裡**一個日期欄位都沒有**（四欄全部是分級資料），生效日只寫在 metadata 的資源說明
 * （`115年1月全民健康保險投保金額分級表`）。本檔的簽章裡沒有資源說明也沒有時間，
 * 於是計畫 §7.2 禁止的那幾個 fallback 一行都寫不出來。
 *
 * ⚠️ **16 個資源裡有 9 個的說明只有年份**（`100年…`～`109年…`），那 9 個版本一律失敗、不得猜
 * （同一年可能有兩次調整，實測 `20246` 就有 102年1月 與 102年7月）。因此這個資料集實際回補得到的
 * 最早版本是**民國 110 年 1 月**。判定與訊息在 `regulatory-roc-date.ts` 的 `parseRocYearMonthFromText`。
 *
 * ## 完整性檢查：守的是**級距的連續性**，與 `dataset_code=3` 同構
 *
 * 這張表沒有任何封閉代碼欄位（`組別級距` 每次調整都會變，見形狀定義），因此沒有
 * `dataset_code=1`「四種身分別必須齊全」那樣的清單可比對。對應物是級距本身，它守的是同一件事
 * ——**少了一段會讓某一群人悄悄查不到**：
 *
 * 1. **第一級必須沒有下限、最後一級必須沒有上限，中間每一級兩端都要有。**
 *    這一條擋的是截斷：只抓到半截時最後一列會是一個上下限都有的普通級距，
 *    而那張表在型別、驗證、資料庫層全部合法——只是月薪超過那個上限的人查不到任何一級。
 * 2. **相鄰級距必須首尾相接**（上一級的上限 ＋ 1 ＝ 這一級的下限）。政府刪掉中間一級並重新編號時
 *    級數仍然連號，只有這一條會發現金額上的缺口。
 *    ——實測 `100年` 那一份真的有一個缺口（18301–18780 沒有任何一級涵蓋），這道檢查會擋下它；
 *    它剛好也是推導不出生效日的那九份之一，因此兩道門的結論一致。
 * 3. **月投保金額必須等於該級的級距上限**（最高一級除外，它沒有上限）。
 *    這是政府那一份自己的內部一致性：`29501-30300` 這一級的投保金額就是 30300。
 *    對不起來就是某一欄錯位或某一格打錯，而每一個值單獨看都完全合法。
 * 4. **級數頭尾錨定**：第一列是 1、最後一列等於列數。
 *    刻意**不做**逐列的連號比對，理由見 `regulatory-health-insurance-premium-share.ts`
 *    ——政府在同一批資料的另一份裡真的把某一列的級數打錯過，而級數不是我們的識別鍵。
 *    「中間少一列」由第 2 條擋，而它比連號強。
 *
 * ## 數值一律 decimal 字串
 *
 * 全檔沒有一個 `Number(...)` 參與金額（§4.7）。`Number` 只出現在 `sort_order`（列序）上。
 */
import type { RegulatoryRecordData } from '../../datasets/regulatory-datasets.service.ts'
import { INTEGER_AMOUNT_PATTERN, normalizeAmount, parseHyphenatedAmountRange } from './regulatory-amount.ts'
import { parseCsvTable, readCsvField } from './regulatory-csv.ts'
import type { ParsedRegulatoryRecord, RegulatoryRecordsResult } from './regulatory-sync-model.ts'

/** `dataset_code=2` 的 `data` 形狀（唯一來源在 `datasets/domain/regulatory-record-shape.ts`）。 */
type HealthInsuranceSalaryGrade = RegulatoryRecordData<2>

/**
 * 形狀的欄位 → 政府 CSV 的欄位名。**逐字寫出來**：欄位改名要當場失敗，不要靜靜地讀到 `undefined`。
 *
 * `satisfies Record<Exclude<keyof 形狀, 兩個推導欄位>, string>` 讓兩邊**總對總**：
 * 形狀多一欄卻沒有對應的來源欄位、或這裡多一個形狀上不存在的 key，兩個方向都當場編譯不過。
 * 被排除的兩欄（`actualSalaryFrom`／`actualSalaryTo`）是從 `實際薪資月額（元）` **拆出來**的，
 * 來源裡沒有對應欄位——**排除是寫出來的動作，不是忘了列**。
 *
 * ⚠️ **宣告順序就是 CSV 的欄位順序**：下面的 {@link CSV_HEADER} 由 `Object.values` 推導，
 * 而字串 key 的列舉順序即插入順序。順序寫錯時表頭比對會當場失敗（而不是靜靜讀錯欄），
 * 因此這是一個會在第一次執行就發現的錯誤，不是一顆地雷。
 */
const FIELD = {
  groupRangeText: '組別級距',
  grade: '投保等級',
  monthlyInsuredAmount: '月投保金額（元）',
  actualSalaryRangeText: '實際薪資月額（元）',
} as const satisfies Record<Exclude<keyof HealthInsuranceSalaryGrade, 'actualSalaryFrom' | 'actualSalaryTo'>, string>

/**
 * 期望的 CSV 表頭。**由 {@link FIELD} 推導，不另外列一份**：另外列的那一份哪天與 `FIELD` 分岔，
 * 症狀是表頭比對通過、`readCsvField` 卻讀到 `undefined`，而錯誤訊息會指向欄位內容。
 */
const CSV_HEADER: readonly string[] = Object.values(FIELD)

/** 級數：正整數字串。 */
const GRADE_PATTERN = /^\d+$/

/**
 * 解析全民健康保險投保金額分級表。
 *
 * @param rawText 政府 CSV 資源的原始內容（未經任何前處理，與寫進 `raw_data` 的是同一串）。
 *
 * ## `record_key` 為什麼是 `amount-{月投保金額}`
 *
 * 資料字典要求 `record_key` 在**同一版本內唯一**、且**跨版本穩定**。
 *
 * - **不能用 `投保等級`**：它是位置，不是內容。基本工資一調，低薪的那幾級被刪掉，
 *   後面每一級的級數整批往前位移——實測第 1 級在民國 110 年是 24000、在 115 年是 29500。
 *   拿它當 key 的話，跨版本比對會說「每一級的金額都變了」，而真正發生的事是「前面幾級不見了」。
 *   它的正確位置是 `code` 與 `sort_order`。
 *   （這與 `dataset_code=3` 相反，那張表的級數是穩定的分級軸，金額才是每期變動的值。
 *   兩張表看起來很像，但變的是不同的一端，因此 key 的選擇剛好相反——這一點要寫下來，
 *   否則下一個人會為了「一致」把其中一邊改成另一邊的寫法。）
 * - **月投保金額是這一級的內容識別**：「投保金額 30300 這一級」在每一個版本裡問的都是同一件事，
 *   而它也正是 Payroll 拿去查 `dataset_code=5` 負擔金額表的那個值——兩張表用同一種 key，
 *   跨表對照就不需要任何轉換。
 * - **不用實際薪資月額區間**：那是一段範圍，而範圍的兩端每期都在動。
 *
 * 前綴 `amount-` 是刻意的：純數字的 key 看起來像一個可以拿去比大小的量，而它是一個識別碼。
 *
 * ## `version_code` 不由這裡決定
 *
 * 版本代碼由生效日推導（`YYYY-MM`），規則對所有資料集共用，放在 `regulatory-sync-source.ts`。
 */
export const parseHealthInsuranceSalaryGrades = (rawText: string): RegulatoryRecordsResult => {
  const table = parseCsvTable(rawText, { header: CSV_HEADER, label: '全民健康保險投保金額分級表' })
  if (!table.ok) return { ok: false, reason: table.reason }

  const { rows } = table
  const lastIndex = rows.length - 1
  const records: ParsedRegulatoryRecord[] = []
  const seenKeys = new Set<string>()
  /** 上一級的級距上限，供「首尾相接」檢查。第一級之前沒有上一級。 */
  let previousRangeTo: string | null = null

  for (const [index, row] of rows.entries()) {
    const position = `第 ${String(index + 1)} 列`

    const grade = readCsvField(row, FIELD.grade)
    if (grade === null || !GRADE_PATTERN.test(grade)) {
      return { ok: false, reason: `${position}的「${FIELD.grade}」不是正整數：${JSON.stringify(grade)}` }
    }

    const groupRangeText = readCsvField(row, FIELD.groupRangeText)
    if (groupRangeText === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.groupRangeText}」` }
    }

    const rawAmount = readCsvField(row, FIELD.monthlyInsuredAmount)
    const monthlyInsuredAmount = rawAmount === null ? null : normalizeAmount(rawAmount)
    if (monthlyInsuredAmount === null || !INTEGER_AMOUNT_PATTERN.test(monthlyInsuredAmount)) {
      return {
        ok: false,
        reason: `${position}的「${FIELD.monthlyInsuredAmount}」不是整數金額：${JSON.stringify(rawAmount)}`,
      }
    }

    const rangeText = readCsvField(row, FIELD.actualSalaryRangeText)
    if (rangeText === null) {
      return { ok: false, reason: `${position}缺少「${FIELD.actualSalaryRangeText}」` }
    }
    // 分隔符號是半形連字號（`29501-30300`），不是「至」——健保署與勞動部的寫法不同。
    const range = parseHyphenatedAmountRange(rangeText, { label: FIELD.actualSalaryRangeText })
    if (!range.ok) return { ok: false, reason: `${position}的${range.reason}` }

    // 完整性檢查（一）：開放的那一端只准出現在頭尾。
    const isFirst = index === 0
    const isLast = index === lastIndex
    if (isFirst !== (range.value.from === null)) {
      return {
        ok: false,
        reason: isFirst
          ? `${position}是第一級，「${FIELD.actualSalaryRangeText}」應該是「N以下」（沒有下限）：${JSON.stringify(rangeText)}`
          : `${position}不是第一級，「${FIELD.actualSalaryRangeText}」不該沒有下限：${JSON.stringify(rangeText)}`,
      }
    }
    if (isLast !== (range.value.to === null)) {
      return {
        ok: false,
        reason: isLast
          ? // 「只抓到半截」的攔截點：被截斷的表最後一列會是一個普通的封閉級距，
            // 而月薪高於它的人從此查不到任何一級。
            `${position}是最後一級，「${FIELD.actualSalaryRangeText}」應該是「N以上」（沒有上限）：${JSON.stringify(rangeText)}` +
            '；若這是完整的資料，代表政府改了最高級的寫法'
          : `${position}不是最後一級，「${FIELD.actualSalaryRangeText}」不該沒有上限：${JSON.stringify(rangeText)}`,
      }
    }

    // 完整性檢查（二）：上一級的上限 ＋ 1 ＝ 這一級的下限。
    if (previousRangeTo !== null && range.value.from !== null) {
      const expectedFrom = BigInt(previousRangeTo) + 1n
      if (BigInt(range.value.from) !== expectedFrom) {
        return {
          ok: false,
          reason:
            `${position}的「${FIELD.actualSalaryRangeText}」下限是 ${range.value.from}，` +
            `但上一級的上限是 ${previousRangeTo}（期望 ${expectedFrom.toString()}）：` +
            '級距之間出現缺口或重疊，落在缺口裡的薪資查不到任何一級',
        }
      }
    }
    previousRangeTo = range.value.to

    // 完整性檢查（三）：月投保金額 ＝ 該級的級距上限（最高一級沒有上限，因此跳過）。
    if (range.value.to !== null && BigInt(range.value.to) !== BigInt(monthlyInsuredAmount)) {
      return {
        ok: false,
        reason:
          `${position}的「${FIELD.monthlyInsuredAmount}」是 ${monthlyInsuredAmount}，` +
          `與「${FIELD.actualSalaryRangeText}」的上限 ${range.value.to} 不同：` +
          '這一級的投保金額本來就是它的級距上限，對不起來代表欄位錯位或某一格打錯',
      }
    }

    const recordKey = `amount-${monthlyInsuredAmount}`
    if (seenKeys.has(recordKey)) {
      // 撞 key 代表同一個月投保金額出現兩次。放行的話會在寫入時撞
      // `UNIQUE(dataset_version_id, record_key)`，而那時只會看到一句 SQL 唯一鍵違反。
      return { ok: false, reason: `${position}的 record_key 重複：${recordKey}` }
    }
    seenKeys.add(recordKey)

    const data: HealthInsuranceSalaryGrade = {
      groupRangeText,
      grade,
      monthlyInsuredAmount,
      actualSalaryRangeText: rangeText,
      actualSalaryFrom: range.value.from,
      actualSalaryTo: range.value.to,
    }

    records.push({
      recordKey,
      // `code` 是業務代碼（級數）。`name` 沒有對應物——`組別級距` 是分組標籤，一組涵蓋好幾列，
      // 拿它當這一列的名稱會讓每五、六筆長得一模一樣；它在 `data` 裡。
      code: grade,
      name: null,
      rangeFrom: range.value.from,
      rangeTo: range.value.to,
      // 這一級實際用來計算保費的金額。級距上下限在 `range_*`，這一欄是**結果**不是邊界
      //（最高一級的區間是「303001以上」而金額是 313000，兩者不是同一個數）。
      amount: monthlyInsuredAmount,
      // 本資料集不含費率：健保費率不在這張表上，而每一級要繳多少錢在 `dataset_code=5` 的負擔金額表。
      rate: null,
      data,
      sortOrder: Number(grade),
    })
  }

  // 完整性檢查（四）：級數頭尾錨定。中間少一列時最後一列的級數會大於列數。
  const firstGrade = records[0]?.code
  const lastGrade = records[lastIndex]?.code
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
