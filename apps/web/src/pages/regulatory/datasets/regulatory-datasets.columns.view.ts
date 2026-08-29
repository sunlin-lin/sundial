/**
 * 九個資料集各自的欄位定義（計畫 03 §5.3；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * **這一份是資料，不是九個分支。** 加第十個資料集就是加一筆，不必動模板，也不必動這個檔案——
 * 只要在對應族群的兄弟檔（或新的族群檔）裡補一筆，`COLUMN_BUILDERS` 的 `satisfies` 會在少了任何
 * 一碼時編譯不過。
 *
 * ## 為什麼這裡是三個 `import` 而不是九筆定義
 *
 * 原本九筆定義攤平寫在同一個函式裡，單一檔案破了 §0.7 的 150 行上限——而那不是巧合：
 * §0.7 檔頭自己點名了這個模式（「把邏輯從 `.vue` 擠進 `view.ts`」的必然後果是 `view.ts` 變成新的
 * 堆放處）。拆法依資料集的**表格族群**分（`.columns-bracket.view.ts` 是級距表、
 * `.columns-rate-amount.view.ts` 是費率與金額表、`.columns-other.view.ts` 是形狀互異的另外三個），
 * 而不是機械地按行數切——族群相同的定義擺在一起，改一份時另外幾份是最直接的參照；
 * 機械對半切只會把「級距 1」與「級距 2」的定義分到看不見彼此的兩個檔案裡。
 *
 * 本檔因此只剩「合併三個族群 ＋ 對外提供單一入口 `columnsFor`」，這兩件事不會隨資料集數量成長，
 * 所以永遠不會再破 150 行。
 */
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { DatasetCode } from './regulatory-datasets.payload.ts'
import type { ColumnsBuilder, RecordColumn } from './regulatory-datasets.record.view.ts'
import { BRACKET_TABLE_COLUMNS } from './regulatory-datasets.columns-bracket.view.ts'
import { RATE_AMOUNT_TABLE_COLUMNS } from './regulatory-datasets.columns-rate-amount.view.ts'
import { OTHER_TABLE_COLUMNS } from './regulatory-datasets.columns-other.view.ts'

/**
 * 資料集代碼 → 欄位定義的建構子。
 *
 * `satisfies Record<DatasetCode, ColumnsBuilder>` 是這一份的自動檢查：**後端新增一個資料集時，
 * 三個族群檔裡少了一筆，這裡的合併就編譯不過**。少了它，新資料集的內容區會渲染出一張沒有任何
 * 欄位的空表格，而「表格是空的」與「這個版本沒有資料」在畫面上長得一模一樣。
 * `7` 不在這裡：那是永久空號，不是漏打（後端 `regulatory-dataset-code.ts` 檔頭）。
 */
const COLUMN_BUILDERS = {
  ...BRACKET_TABLE_COLUMNS,
  ...RATE_AMOUNT_TABLE_COLUMNS,
  ...OTHER_TABLE_COLUMNS,
} as const satisfies Record<DatasetCode, ColumnsBuilder>

/**
 * @param translate 只有固定代碼欄需要它（把 `'monthly'` 變成「每月最低工資」）。
 *   傳進來而不是在這裡 import i18n 實例：本檔要能被純函式測試直接呼叫（§8.1）。
 */
export const columnsFor = (datasetCode: DatasetCode, translate: TranslateMessage): readonly RecordColumn[] =>
  COLUMN_BUILDERS[datasetCode](translate)
