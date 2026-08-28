/**
 * 金額與費率的顯示格式化：**decimal 字串進、顯示字串出，中間沒有一個 `number`**。
 *
 * ## 為什麼這一檔要存在（計畫 §5.2）
 *
 * 後端花了很多力氣讓數字不失真：金額與費率一律是 decimal 字串，從資料庫到 API 全程不經過
 * `number`（後端規範 §4.7 逐字寫著「浮點誤差在薪資單上就是實發金額差一塊錢對不起來，
 * 而**勞健保級距在邊界值上會選錯級距**，錯的是法定金額」）。前端一行就能把它全部丟掉：
 *
 * ```ts
 * Number(record.data.monthlyContributionWage).toLocaleString()   // ✗
 * ```
 *
 * 那一行看起來完全正常，而且在絕大多數值上都對——直到某個級距的邊界值。它不會拋錯、
 * 不會有 log、型別完全合法，唯一的症狀是某一個人的保費差一塊錢。
 *
 * 這裡的每一支都只做**字串到字串**的轉換：千分位靠字串切割、百分比靠小數點位移。
 * 作法與理由照抄後端的 `apps/api/src/modules/regulatory/sync/domain/regulatory-amount.ts`
 * ——同一個問題在兩端各解一次，但**解法必須是同一種**，否則兩邊對同一個值會產生不同的字串。
 *
 * ## 三種輸入、三種處置（這一段就是本檔的判準表）
 *
 * | 輸入 | 處置 | 為什麼 |
 * |---|---|---|
 * | 合法的 decimal 字串 | 格式化後輸出 | 正常路徑 |
 * | `null` / `undefined` / 空字串 | {@link EMPTY_DISPLAY} | 「沒有值」是一種合法狀態（欄位可為空、該版本沒有這一項） |
 * | 讀不懂的字串（`'1e5'`、`'abc'`、`'1,000'`、`'.5'`） | **原樣輸出** | 見下 |
 *
 * **讀不懂就原樣輸出，不猜、也不隱藏。** 三個選項各有代價，這裡選最吵的那一個：
 *
 * - 回 `EMPTY_DISPLAY`：格式變了會表現成「這一欄全空」，而空白在這個系統裡是合法狀態
 *   （計畫 §4.1），於是沒有人會去查——**最壞的一種**，它把一個格式變更偽裝成一筆缺資料。
 * - 拋例外：整頁白掉。一列資料的格式問題不該讓其他九列也看不到。
 * - 原樣輸出：使用者看到 `1e5`，那看起來就是壞的，會被回報。這與 i18n 找不到插值時
 *   原樣印出 `{{name}}` 是同一種取捨（見後端 `check-message-params.ts`）：畫面照樣渲染，
 *   但錯誤是**看得見的**。
 *
 * ## 不做四捨五入、不去尾零、不補位
 *
 * §9.2 說「金額千分位無小數（TWD）」——那是**資料的性質**（台幣金額是整數元），
 * 不是這裡該用截斷去強制的事。輸入帶了小數就照樣顯示：那代表後端送來的東西跟預期不同，
 * 而截掉它等於把這個訊號抹掉。費率同理，`0.1150` 顯示成 `11.50%` 而不是 `11.5%`
 * ——政府用幾位小數表達一個費率，本身就是公告的一部分（理由與後端 `shiftDecimalLeft` 相同）。
 */
import { EMPTY_DISPLAY } from './empty-display.ts'

/**
 * 十進位字串：可帶負號，不接受正號、指數（`1e5`）、千分位逗號、`.5` 與 `5.` 這類省略寫法。
 *
 * **接受負號、後端的同名 pattern 不接受**，兩邊不是抄漏了：後端那支讀的是政府公告的原文
 * （金額與費率不會是負的，出現負號代表讀錯欄），前端這支顯示的是 API 回來的任何金額欄位，
 * 而扣項、補發、調整在業務上本來就會是負的。
 *
 * **不接受逗號**是刻意的：`'1,000'` 出現在這裡代表某一層已經格式化過一次，
 * 再格式化一次會得到什麼取決於實作細節。原樣輸出讓那個重複格式化被看見。
 */
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

/** 百分比是把小數點右移兩位（`0.115` = `11.5%`）。 */
const PERCENT_SHIFT = 2

/** 千分位分隔的位數。 */
const GROUP_SIZE = 3

/** 拆好的十進位字串。整數位與小數位分開拿著，後面每一步都只動其中一邊。 */
type DecimalParts = {
  /** 是否為負。全部數字都是 0 時一律 `false`，見 {@link splitDecimal}。 */
  readonly isNegative: boolean
  /** 整數位的數字（不含負號），至少一位。 */
  readonly integerDigits: string
  /** 小數位的數字，沒有小數點時是空字串。**保留輸入的位數**，不補不去。 */
  readonly fractionDigits: string
}

/**
 * 合法的十進位字串 → 拆好的三段。讀不懂時回 `undefined`，由呼叫端決定怎麼處置。
 *
 * **`-0` 會被正規化成 `0`**（`-0.00` → `0.00`，小數位保留）：畫面上出現一個 `-0` 元，
 * 讀的人只會停下來想「這是什麼意思」，而它跟 `0` 是同一個值。這是本檔唯一一處改寫輸入的地方，
 * 而它沒有改變值，只改變了寫法。
 */
const splitDecimal = (text: string): DecimalParts | undefined => {
  if (!DECIMAL_PATTERN.test(text)) return undefined

  const isSigned = text.startsWith('-')
  const unsigned = isSigned ? text.slice(1) : text
  const [integerDigits = '', fractionDigits = ''] = unsigned.split('.')

  return {
    isNegative: isSigned && /[1-9]/.test(unsigned),
    integerDigits,
    fractionDigits,
  }
}

/**
 * 整數位字串加千分位逗號，**從右邊每三位切一刀**。
 *
 * 全程 `slice`，因此位數沒有上限——勞保級距的金額目前是五位數，但這支函式不知道這件事，
 * 也不需要知道。用 `Number` 或 `Intl.NumberFormat` 的版本會在 2^53 之後靜靜地開始給出錯的數字，
 * 而那個界線在型別上完全看不見。
 */
const groupThousands = (integerDigits: string): string => {
  const groups: string[] = []
  for (let end = integerDigits.length; end > 0; end -= GROUP_SIZE) {
    groups.unshift(integerDigits.slice(Math.max(end - GROUP_SIZE, 0), end))
  }
  return groups.join(',')
}

/** 前導零只在「後面還有數字」時剝掉，`'000'` 剝成 `'0'` 而不是空字串。 */
const stripLeadingZeros = (digits: string): string => digits.replace(/^0+(?=\d)/u, '')

/** 把三段組回一個十進位字串。小數位是空字串時**不留小數點**（`'5.'` 不是合法的顯示）。 */
const joinDecimal = (isNegative: boolean, integerText: string, fractionDigits: string): string =>
  `${isNegative ? '-' : ''}${integerText}${fractionDigits === '' ? '' : `.${fractionDigits}`}`

/** 共用的入口處置：`null` / `undefined` / 空字串一律是「沒有值」，其餘去掉前後空白後往下走。 */
const normalizeInput = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * 金額的 decimal 字串 → 千分位顯示字串。
 *
 * @param value API 回來的金額欄位。`null` / `undefined` / 空字串代表沒有值。
 *
 * ```ts
 * formatAmount('45800')       // '45,800'
 * formatAmount('-1234.50')    // '-1,234.50'   小數位原樣保留
 * formatAmount('0')           // '0'
 * formatAmount(null)          // '—'
 * formatAmount('1e5')         // '1e5'         讀不懂就原樣輸出，見檔頭
 * ```
 *
 * **沒有幣別符號、沒有單位。** 「元」「NT$」屬於欄位標題或語系檔（§9.2 要求使用者可見字串
 * 走語系檔 key），混進格式化函式之後，同一支函式會被迫長出「要不要帶單位」的參數，
 * 而那個參數在每個呼叫點都要重新決定一次。
 */
export const formatAmount = (value: string | null | undefined): string => {
  const text = normalizeInput(value)
  if (text === undefined) return EMPTY_DISPLAY

  const parts = splitDecimal(text)
  if (parts === undefined) return text

  return joinDecimal(parts.isNegative, groupThousands(parts.integerDigits), parts.fractionDigits)
}

/**
 * 比率的 decimal 字串 → 百分比顯示字串（`'0.115'` → `'11.5%'`）。
 *
 * @param value API 回來的費率欄位，語意是**比率**（`0.115`）而不是百分比數字（`11.5`）。
 *   這一點由後端定死（見 `regulatory-amount.ts` 的 `percentToRate`：兩種表達法都是合法的
 *   decimal 字串、都通得過驗證，而算出來的保費差 100 倍）。前端這裡只做同一個約定的下半段。
 *
 * **小數點位移全程字串運算，不寫成 `Number(value) * 100`。**
 * `Number('0.29') * 100` 在 IEEE 754 下是 `28.999999999999996`，於是畫面會出現
 * `28.999999999999996%`——那還算好的，因為它一眼看得出壞掉。真正危險的是
 * `Number('0.07') * 100 === 7.000000000000001` 這種：配上 `toFixed(2)` 會顯示成 `7.00%`，
 * 看起來完全正常，而位移過的那一位在別的值上就不一定被四捨五入吃掉。
 *
 * ```ts
 * formatRate('0.115')   // '11.5%'
 * formatRate('0.1150')  // '11.50%'   尾零保留：政府用幾位小數是公告的一部分
 * formatRate('0.0211')  // '2.11%'
 * formatRate('1')       // '100%'
 * formatRate('0')       // '0%'
 * formatRate(null)      // '—'
 * ```
 *
 * **不加千分位**：費率位移兩位之後仍然是個位到三位數，加逗號只會讓它看起來像金額。
 */
export const formatRate = (value: string | null | undefined): string => {
  const text = normalizeInput(value)
  if (text === undefined) return EMPTY_DISPLAY

  const parts = splitDecimal(text)
  if (parts === undefined) return text

  // 小數點右移兩位：把兩段接成一串數字，再重新決定小數點插在第幾位。
  // 整數位不夠移時（`'0.5'` 只有一位小數）在**右邊**補零把它推到定位——
  // 補的是小數位的空缺，不是在改精度：`0.5` 與 `0.50` 是同一個值，而 `50%` 與 `5%` 不是。
  const digits = `${parts.integerDigits}${parts.fractionDigits}`
  const pointIndex = parts.integerDigits.length + PERCENT_SHIFT
  const padded = digits.padEnd(pointIndex, '0')

  const integerText = stripLeadingZeros(padded.slice(0, pointIndex))
  const fractionText = padded.slice(pointIndex)

  return `${joinDecimal(parts.isNegative, integerText, fractionText)}%`
}
