/**
 * 六種欄位建構子（§0.7 從 `.record.view.ts` 再拆出來的兄弟檔——形狀與讀值機制留在那邊，
 * 這裡放的是「哪一種欄位該怎麼格式化」）。
 *
 * 拆開的理由不是行數本身，是**這裡的複雜度來源與 `.record.view.ts` 不同**：那邊是「`data`
 * 這個聯集要怎麼被安全地索引」，這裡是「六種欄位語意（文字／金額／費率／固定代碼／日期／
 * 陣列裡的第 N 格）各自要怎麼呈現」。兩件事分別看都不長，混在同一個檔案裡才會一起破 150 行。
 *
 * `.columns*.view.ts`（九個資料集依族群拆出的欄位定義）都是靠 import 這裡的建構子組出一份
 * `readonly RecordColumn[]`，本檔完全不知道「哪個資料集用了哪幾種建構子」。
 *
 * ## 金額與費率一律走 `shared/format/`（計畫 §5.2）
 *
 * 後端的金額與費率一律是 decimal 字串，全程不經過 `number`；前端一行 `Number(` 就能把它全部丟掉，
 * 而那一行在絕大多數值上都對——直到某個級距的邊界值。`bun run check:number-cast` 擋這件事，
 * 下面每一支建構子都保證每一格經過 `formatAmount` / `formatRate`（字串進、字串出）。
 */
import { formatAmount, formatRate } from '../../../shared/format/decimal.ts'
import { formatDate } from '../../../shared/format/business-date.ts'
import { EMPTY_DISPLAY } from '../../../shared/format/empty-display.ts'
import type { MessageKey } from '../../../shared/i18n/messages.ts'
import { readField, readText, type RecordColumn, type RecordDataKey } from './regulatory-datasets.record.view.ts'

/** 一般文字欄（代碼、名稱、政府原文的區間字串）。 */
export const textColumn = (
  key: RecordDataKey,
  labelKey: MessageKey,
  minWidth: number,
): RecordColumn => ({
  key,
  labelKey,
  align: 'left',
  minWidth,
  read: (data) => readText(data, key) ?? EMPTY_DISPLAY,
})

/**
 * 金額欄。**靠右對齊**：一整欄數字靠左時，位數不同的兩個金額要逐位比對才看得出大小，
 * 而這一頁的主要動作正是「上下比對兩級差多少」。
 */
export const amountColumn = (
  key: RecordDataKey,
  labelKey: MessageKey,
  minWidth: number,
): RecordColumn => ({
  key,
  labelKey,
  align: 'right',
  minWidth,
  read: (data) => formatAmount(readText(data, key)),
})

/** 費率欄（比率 → 百分比字串，`0.115` → `11.5%`）。同樣靠右。 */
export const rateColumn = (
  key: RecordDataKey,
  labelKey: MessageKey,
  minWidth: number,
): RecordColumn => ({
  key,
  labelKey,
  align: 'right',
  minWidth,
  read: (data) => formatRate(readText(data, key)),
})

/**
 * 固定代碼欄（`item: 'monthly' | 'hourly'`、`item: 'rate' | 'chargeLowerBound' | …`）。
 *
 * 這幾個資料集的代碼欄**沒有隨附的原文名稱欄**（`dataset_code=1` 的 `insuredCategoryCode` 旁邊
 * 有 `insuredCategoryName`，那種就直接顯示原文），所以名稱只能由前端給。
 *
 * 對不到時**顯示代碼本身**而不是空白：後端新增一個代碼時，畫面上會出現一格 `singlePayment…`
 * ——那看起來就是壞的，會被回報；顯示空白則是合法狀態，沒有人會查。
 */
export const enumColumn = (
  key: RecordDataKey,
  labelKey: MessageKey,
  minWidth: number,
  valueLabelKeys: Readonly<Record<string, MessageKey>>,
  translate: (key: MessageKey) => string,
): RecordColumn => ({
  key,
  labelKey,
  align: 'left',
  minWidth,
  read: (data) => {
    const code = readText(data, key)
    if (code === null) return EMPTY_DISPLAY
    const valueLabelKey = valueLabelKeys[code]
    return valueLabelKey === undefined ? code : translate(valueLabelKey)
  },
})

/** 日期欄（西元 `YYYY-MM-DD`，計畫 §5.1：不轉民國）。 */
export const dateColumn = (
  key: RecordDataKey,
  labelKey: MessageKey,
  minWidth: number,
): RecordColumn => ({
  key,
  labelKey,
  align: 'left',
  minWidth,
  read: (data) => formatDate(readText(data, key)),
})

/**
 * 陣列裡第 N 格的金額欄（扣繳稅額表的「配偶及受扶養親屬計 N 人」）。
 *
 * 12 格各自是一欄而不是一整欄塞 12 個數字：使用者要找的是「這個薪資級距、扶養 3 人要扣多少」，
 * 那是一個交叉查表的動作，而交叉查表需要欄。用 {@link readField}（不是 `readText`）——
 * 這一欄的來源在 `data` 上是陣列，不是字串，`readText` 會把它當成「沒有值」。
 */
export const arrayAmountColumn = (
  key: RecordDataKey,
  index: number,
  labelKey: MessageKey,
  minWidth: number,
): RecordColumn => ({
  key: `${key}.${String(index)}`,
  labelKey,
  align: 'right',
  minWidth,
  read: (data) => {
    const value = readField(data, key)
    if (!Array.isArray(value)) return EMPTY_DISPLAY
    const cell: unknown = value[index]
    return typeof cell === 'string' ? formatAmount(cell) : EMPTY_DISPLAY
  },
})
