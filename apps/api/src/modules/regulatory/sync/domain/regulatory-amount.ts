/**
 * 政府資料裡的「數字字串」怎麼讀（零 IO 純函式，§0.1）。
 *
 * 這裡的每一支都只做**字串到字串**的轉換，**全檔沒有一個 `Number(...)` 參與金額或費率**
 * （§4.7、計畫 §6.1）。理由是規範逐字點名的那一句：浮點誤差在薪資單上是實發金額差一塊錢，
 * 而勞健保級距在邊界值上會**選錯級距**，錯的是法定金額。金額從政府那串字串進來、以字串出去，
 * 中間只做「去逗號」「移小數點」這種**沒有損失資訊**的動作；要比大小時用 `BigInt`。
 *
 * ## 為什麼抽成一個共用檔，而不是每支解析器各寫一份
 *
 * 三種東西在多個資料集重複出現，而且**每一份都有機會被改鬆**：
 *
 * - 中文區間句型（`1501至3000`／`29501元至30300元`／`29501-30300`）：`3`、`1`、`2` 各一種寫法；
 * - 百分比 → 費率（`11.5%` → `0.115`）：`4` 與 `6` 各一份，而兩者的百分號位置不同；
 * - 「這是不是一個沒有經過浮點的整數金額」：四個資料集都要問。
 *
 * 抄成多份的代價不是行數，是**分岔**：其中一份哪天為了讓某個新格式通過而放寬了一個 pattern，
 * 另外幾份不會跟著鬆，於是同一個概念在不同資料集有不同的嚴格度，而 review 時看不出來。
 *
 * ## 每一支都把「單位」做成參數，而不是「兩種都接受」
 *
 * `dataset_code=1` 的區間帶「元」（`29500元以下`）、`3` 的不帶（`1500以下`）；
 * `4` 的費率帶百分號（`11.5%`）、`6` 的不帶（欄位名 `行業別費率%` 已經把單位講完了）。
 *
 * 做成「有沒有都接受」看起來寬容，實際上是把**格式變更**變成看不見的事：政府哪天把
 * `29500元以下` 改成 `29500以下`，寬容的版本會照樣解析成功，而那正是我們最需要有人去看一眼的時刻。
 * 因此單位是**必填參數**且型別是封閉聯集——呼叫端必須明講自己期望哪一種。
 */

/** 純整數金額（去逗號之後）。政府的金額欄位目前都是整數元；出現小數即代表格式變了。 */
export const INTEGER_AMOUNT_PATTERN = /^\d+$/

/** 十進位數字（整數或帶小數），不接受正負號、指數與 `.5`／`5.` 這類寫法。 */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/

/**
 * 去掉千分位逗號與前後空白。
 *
 * **接受逗號不是「猜」**：`29,500` 與 `29500` 是同一個值，這一步沒有損失任何資訊，
 * 也沒有做任何推測。政府同一個部會的資源有的帶逗號、有的不帶。
 */
export const normalizeAmount = (value: string): string => value.trim().replaceAll(',', '')

/** 區間的兩端。`null` 代表「這一邊沒有界線」，**不是** 0，也不是某個很大的數（理由見形狀定義）。 */
export type AmountRange = {
  readonly from: string | null
  readonly to: string | null
}

export type AmountRangeResult =
  | { readonly ok: true; readonly value: AmountRange }
  | { readonly ok: false; readonly reason: string }

/** 區間字串的金額後面接什麼單位。封閉聯集：呼叫端必須明講，見檔頭。 */
export type AmountUnit = '元' | ''

type RangePatterns = {
  /** 「29500元以下」「1500以下」：沒有下限。 */
  readonly upTo: RegExp
  /** 「29501元至30300元」「1501至3000」：兩端都有。 */
  readonly between: RegExp
  /** 「43901元以上」「147901以上」：沒有上限。 */
  readonly from: RegExp
}

/**
 * 兩種單位各一組 pattern，**寫成字面值常數而不是 `new RegExp(\`…${unit}…\`)`**。
 *
 * 動態組出來的 pattern 在單位是空字串時會變成另一個意思（`^(\d[\d,]*)以下$`），
 * 那一步是對的，但它讓「這支函式到底接受哪些句型」變成要在腦中組字串才看得出來的事，
 * 而這正是政府改格式時第一個要被人讀懂的地方。
 */
const RANGE_PATTERNS = {
  元: {
    upTo: /^(\d[\d,]*)元以下$/,
    between: /^(\d[\d,]*)元至(\d[\d,]*)元$/,
    from: /^(\d[\d,]*)元以上$/,
  },
  '': {
    upTo: /^(\d[\d,]*)以下$/,
    between: /^(\d[\d,]*)至(\d[\d,]*)$/,
    from: /^(\d[\d,]*)以上$/,
  },
} as const satisfies Record<AmountUnit, RangePatterns>

/**
 * 三種句型的共用比對。{@link parseAmountRange} 與 {@link parseHyphenatedAmountRange} 都走這一支，
 * 於是「讀不懂就失敗」「上下限顛倒就失敗」「去逗號」這三條規則只有一份實作。
 *
 * @param expectation 讀不懂時要告訴看紀錄的人「我們期望的是哪三種句型」——那句話會原樣進
 *   `regulatory_sync_logs.error_message`，而它是判斷「政府改了寫法」還是「我們讀錯欄」的依據。
 */
const matchAmountRange = (
  rangeText: string,
  patterns: RangePatterns,
  options: { readonly label: string; readonly expectation: string },
): AmountRangeResult => {
  const text = rangeText.trim()
  const { label, expectation } = options

  const upTo = patterns.upTo.exec(text)
  if (upTo !== null) {
    const to = normalizeAmount(upTo[1] ?? '')
    if (!INTEGER_AMOUNT_PATTERN.test(to)) {
      return { ok: false, reason: `${label}的金額不是整數：${JSON.stringify(rangeText)}` }
    }
    return { ok: true, value: { from: null, to } }
  }

  const between = patterns.between.exec(text)
  if (between !== null) {
    const from = normalizeAmount(between[1] ?? '')
    const to = normalizeAmount(between[2] ?? '')
    if (!INTEGER_AMOUNT_PATTERN.test(from) || !INTEGER_AMOUNT_PATTERN.test(to)) {
      return { ok: false, reason: `${label}的金額不是整數：${JSON.stringify(rangeText)}` }
    }
    // 上下限顛倒代表政府那一份的兩欄對調了（或句型變了）。金額本身都合法，
    // 因此除了這一行沒有任何地方會發現——而級距查詢會變成一個永遠命不中的區間。
    if (BigInt(from) > BigInt(to)) {
      return { ok: false, reason: `${label}的下限大於上限：${JSON.stringify(rangeText)}` }
    }
    return { ok: true, value: { from, to } }
  }

  const fromOnly = patterns.from.exec(text)
  if (fromOnly !== null) {
    const from = normalizeAmount(fromOnly[1] ?? '')
    if (!INTEGER_AMOUNT_PATTERN.test(from)) {
      return { ok: false, reason: `${label}的金額不是整數：${JSON.stringify(rangeText)}` }
    }
    return { ok: true, value: { from, to: null } }
  }

  return {
    ok: false,
    reason: `${label}的區間句型無法辨識（期望${expectation}）：${JSON.stringify(rangeText)}`,
  }
}

/**
 * 中文區間字串 → 上下限。
 *
 * @param rangeText 政府原文，例如 `29501元至30300元`（`1`）或 `1501至3000`（`3`）。
 * @param options `unit` 是期望的單位（見檔頭）；`label` 是政府那一欄的欄位名，
 *   只用來組錯誤訊息——那句話會原樣進 `regulatory_sync_logs.error_message`，
 *   而看紀錄的人要能當場知道是**哪一欄**讀不懂，光說「區間讀不懂」得回頭翻程式碼。
 *
 * 三種句型之外**一律失敗**，這是計畫 §7.2 的精神：讀不懂就停下來，不要挑一個看起來合理的解釋。
 * 一個常見的誘惑是「看不懂就把上下限都設成該級的金額」——那會產生一張每一級都只涵蓋單一金額的
 * 分級表，而它在型別、驗證、資料庫層全部合法。
 */
export const parseAmountRange = (
  rangeText: string,
  options: { readonly unit: AmountUnit; readonly label: string },
): AmountRangeResult =>
  matchAmountRange(rangeText, RANGE_PATTERNS[options.unit], {
    label: options.label,
    expectation: `「N${options.unit}以下」「N${options.unit}至N${options.unit}」「N${options.unit}以上」`,
  })

/**
 * 健保署那兩份的區間句型：**分隔符號是半形連字號**（`29501-30300`），不是「至」。
 *
 * `dataset_code=2` 的 `實際薪資月額（元）` 就是這一種（2026-08 實測 16 個資源皆然）。
 *
 * **為什麼是另一支函式，而不是給 {@link parseAmountRange} 多一種「單位」**：
 * 差別不在單位（兩邊都不帶「元」），在分隔符號。硬塞進 `unit` 參數會讓 `unit: '-'` 讀起來像
 * 「金額後面接一個連字號」，而那是另一件事。兩支共用下面的 {@link matchAmountRange}，
 * 因此「讀不懂就失敗」「上下限顛倒就失敗」「去逗號」這三條規則仍然只有一份實作。
 */
const HYPHEN_RANGE_PATTERNS: RangePatterns = {
  upTo: /^(\d[\d,]*)以下$/,
  between: /^(\d[\d,]*)-(\d[\d,]*)$/,
  from: /^(\d[\d,]*)以上$/,
}

/** 連字號分隔的中文區間字串 → 上下限。參數與回傳的語意同 {@link parseAmountRange}。 */
export const parseHyphenatedAmountRange = (
  rangeText: string,
  options: { readonly label: string },
): AmountRangeResult =>
  matchAmountRange(rangeText, HYPHEN_RANGE_PATTERNS, { label: options.label, expectation: '「N以下」「N-N」「N以上」' })

/** 百分比字串後面接不接百分號。封閉聯集，理由與 {@link AmountUnit} 相同。 */
export type PercentSuffix = '%' | ''

export type RateResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string }

/** 百分比 → 比率要把小數點左移兩位（`11.5%` = `0.115`）。 */
const PERCENT_SHIFT = 2

/**
 * 十進位字串的小數點左移 `places` 位，**全程字串運算**。
 *
 * 不寫成 `String(Number(value) / 100)`：`11.5 / 100` 在 IEEE 754 下是 `0.115`（看起來對），
 * 但 `0.29 / 100` 是 `0.0029000000000000002`——而那個值會通過 decimal 字串的 pattern、
 * 通過形狀驗證、寫進資料庫，然後在某一級的保費上差一塊錢。
 *
 * **不去尾零**（`11.50%` → `0.1150` 而不是 `0.115`）：去尾零是在改寫政府給的精度，
 * 而政府用幾位小數表達一個費率，本身就是公告的一部分。
 */
const shiftDecimalLeft = (value: string, places: number): string => {
  const [intPart = '', fracPart = ''] = value.split('.')
  const digits = `${intPart}${fracPart}`
  // 小數點在 `digits` 裡的新位置。整數位不夠移時是負的，補等量的前導零把它推回 0。
  const pointIndex = intPart.length - places
  const padded = pointIndex < 0 ? `${'0'.repeat(-pointIndex)}${digits}` : digits
  const index = Math.max(pointIndex, 0)
  const head = padded.slice(0, index)
  const tail = padded.slice(index)
  return `${head === '' ? '0' : head}${tail === '' ? '' : `.${tail}`}`
}

/**
 * 百分比字串 → 比率的 decimal 字串（`11.5%` → `0.115`、`0.18` → `0.0018`）。
 *
 * @param percentText 政府原文。
 * @param options `suffix` 是期望的百分號（見檔頭）；`label` 同 {@link parseAmountRange}。
 *
 * **產物是比率（0.115）而不是百分比數字（11.5）**，形式與 migration `0015` 已經寫進資料庫的
 * `{"item":"rate","rate":"0.0211"}` 一致。兩種表達法混用是這個模組最容易發生的靜默錯誤：
 * 兩者都是合法的 decimal 字串、都通得過形狀驗證，而算出來的保費差 100 倍——
 * 100 倍的保費會被人當場發現，**但 100 倍的差額若出現在某一個只影響少數人的欄位上就不會**。
 * 因此「這一欄到底是比率還是百分比」由這支函式一次決定，不留給各解析器各自表述。
 */
export const percentToRate = (
  percentText: string,
  options: { readonly suffix: PercentSuffix; readonly label: string },
): RateResult => {
  const text = percentText.trim()
  const { label, suffix } = options

  if (suffix !== '' && !text.endsWith(suffix)) {
    return {
      ok: false,
      reason: `${label}不是以「${suffix}」結尾（期望例如 11.5${suffix}）：${JSON.stringify(percentText)}`,
    }
  }

  const digits = normalizeAmount(suffix === '' ? text : text.slice(0, -suffix.length))
  if (!DECIMAL_PATTERN.test(digits)) {
    return { ok: false, reason: `${label}不是十進位數字：${JSON.stringify(percentText)}` }
  }

  return { ok: true, value: shiftDecimalLeft(digits, PERCENT_SHIFT) }
}

/** decimal 字串的小數位數。沒有小數點時是 0。 */
const fractionDigits = (value: string): number => value.split('.')[1]?.length ?? 0

/** decimal 字串 → 以 10^scale 為單位的整數。三個值先化到同一個 scale 才比得了。 */
const toScaledInteger = (value: string, scale: number): bigint => {
  const [intPart = '0', fracPart = ''] = value.split('.')
  return BigInt(`${intPart}${fracPart.padEnd(scale, '0')}`)
}

/**
 * `left + right === total`？三個值可以有不同的小數位數，比較全程走 `BigInt`。
 *
 * 用途是「政府自己給的三個數字對不對得起來」（`dataset_code=6` 的
 * 行業別費率 ＋ 上下班費率 ＝ 災保費率）。這種檢查的價值在於它**不需要引進任何法規知識**
 * ——三個數字都在同一列裡，對不起來就是政府那一份的欄位換了位置或我們讀錯了欄，
 * 而欄位換位置之後每一個值單獨看都完全合法。
 */
export const isDecimalSum = (left: string, right: string, total: string): boolean => {
  const scale = Math.max(fractionDigits(left), fractionDigits(right), fractionDigits(total))
  return toScaledInteger(left, scale) + toScaledInteger(right, scale) === toScaledInteger(total, scale)
}
