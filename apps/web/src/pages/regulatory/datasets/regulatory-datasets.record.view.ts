/**
 * 版本內容的核心形狀：`data` 長什麼樣、怎麼從裡面讀一個欄位、一筆 record 怎麼變成表格的一列
 * （§1.3 的第 (1) 類；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * **本檔只放形狀與讀值的最小共用機制**，六種欄位建構子（`textColumn`／`amountColumn`／…）
 * 在 `.record-columns.view.ts`，九個資料集各自的欄位定義在 `.columns.view.ts` 及其依資料集族群
 * 再拆出去的兄弟檔（§0.7：兩份都曾經超過 150 行上限，而那條上限不是形式——§0.7 檔頭自己說明了
 * 為什麼「`.vue` 守住上限、`view.ts` 變成新堆放處」是兩條規則合起來的必然結果）。
 *
 * 相依方向固定是**單向**：`.record-columns.view.ts` import 本檔，本檔不 import 它，
 * `.columns*.view.ts` 再 import `.record-columns.view.ts`。反過來會形成循環相依，
 * 而循環相依在 Vite 底下大多不報錯，症狀是「某個模組在初始化時是 `undefined`」，
 * 只在特定進入順序下發作（§0.11）。
 *
 * **這份定義是前端自己的，不是後端 schema 的複製**（計畫 §5.3）：後端 schema 管的是
 * 「這個值合不合法」，這裡管的是「這一欄叫什麼、怎麼排、怎麼格式化」。兩者形狀相近但責任不同，
 * 硬要共用會逼出一個兩邊都不好用的中間層——而且 §3.5 本來就禁止前端 import 後端的任何東西。
 */
import type { MessageKey, TranslateMessage } from '../../../shared/i18n/messages.ts'
import type { RegulatoryDatasetsResolveData } from '../../../api/generated/api-client.ts'

/** `resolve` 成功且該基準日有適用版本時的回應。`null`（無適用版本）由呼叫端處理。 */
export type ResolvedVersion = NonNullable<RegulatoryDatasetsResolveData>

/** 一筆 record（API 形狀）。 */
export type RecordRow = ResolvedVersion['records'][number]

/** 一筆 record 的 `data`：九個資料集形狀的聯集（後端 `RegulatoryRecordDataSchema`）。 */
export type RecordData = RecordRow['data']

/** 聯集裡**任一**成員的鍵（`keyof` 對聯集只會給共同鍵，所以要靠分配式條件型別攤開）。 */
type AnyKeyOf<TUnion> = TUnion extends unknown ? keyof TUnion : never

/**
 * `data` 上可能出現的欄位鍵。
 *
 * 這個型別就是本檔唯一的自動檢查：欄位定義裡打錯一個鍵（`monthlyInsuredSalery`）當場編譯錯誤，
 * 而不是渲染出一整欄的 `—`。它擋不到的是「這個鍵屬於別的資料集」——那由 `.columns*.view.ts` 的
 * 逐格測試負責（每個資料集餵一筆真實形狀的 `data`，斷言每一欄都讀得出值）。
 */
export type RecordDataKey = AnyKeyOf<RecordData> & string

/**
 * 從 `data` 讀一個欄位。
 *
 * 聯集不能直接用字串索引，所以先把它放寬成一個唯讀記錄再取值——**不是 `as`**（§3.2 禁止用
 * `as` 繞過型別）：這是一次向上指派，TypeScript 自己證明得了它成立，而取出來的值仍然是 `unknown`，
 * 每一支讀值函式都必須自己檢查型別才用得下去。
 *
 * **匯出給 `.record-columns.view.ts` 用**：`arrayAmountColumn` 要讀的是陣列而不是字串，
 * 不能經過下面的 `readText`。
 */
export const readField = (data: RecordData, key: RecordDataKey): unknown => {
  const fields: Readonly<Record<string, unknown>> = data
  return fields[key]
}

/** 讀成字串；不是字串（欄位不存在、或這個資料集沒有這一欄）一律當成「沒有值」。 */
export const readText = (data: RecordData, key: RecordDataKey): string | null => {
  const value = readField(data, key)
  return typeof value === 'string' ? value : null
}

/**
 * 一欄的定義。
 *
 * @property key 顯示列上的欄位鍵。**不一定等於 `data` 的欄位鍵**——扣繳稅額表的 12 個稅額全部
 *   來自同一個陣列欄位，因此各自需要一個自己的顯示鍵。
 * @property read 從 `data` 讀出**已經格式化好的顯示字串**。格式化在 `.record-columns.view.ts`
 *   的建構子裡做而不是在模板做，理由同整份 `.view.ts`：模板那一側沒有型別保護，也沒有測試。
 */
export type RecordColumn = {
  readonly key: string
  readonly labelKey: MessageKey
  readonly align: 'left' | 'right'
  readonly minWidth: number
  readonly read: (data: RecordData) => string
}

/**
 * 「給一份翻譯函式，回這個資料集的欄位定義」——九個資料集族群拆檔（`.columns-*.view.ts`）
 * 與最終查表（`.columns.view.ts`）共用的同一個函式形狀。
 *
 * 大多數資料集不需要 `translate`（固定代碼欄以外的欄位不牽涉語系），那幾個建構子直接寫成
 * `() => [...]`（少收一個參數）仍然滿足這個型別——TypeScript 允許函式實作省略用不到的參數。
 * 統一成同一個型別而不是各族群各自宣告，是為了讓 `.columns.view.ts` 最後合併查表時的
 * `satisfies` 只需要驗一次形狀，而不是驗三種長得很像卻不保證相同的函式型別。
 */
export type ColumnsBuilder = (translate: TranslateMessage) => readonly RecordColumn[]

/**
 * 表格實際吃的一列：`rowKey` ＋ 每一欄一個已經算好的字串。
 *
 * `rowKey` 用後端的 `record_key`（同一個版本內唯一，見後端 schema 的說明），不用陣列索引：
 * 索引當 key 會讓表格在換版本時重用錯的 DOM 節點，症狀是捲動位置與展開狀態跳到別列上。
 */
export type RecordDisplayRow = Readonly<Record<string, string>> & { readonly rowKey: string }

export const toRecordDisplayRows = (
  columns: readonly RecordColumn[],
  records: readonly RecordRow[],
  // 回傳可變陣列（元素本身仍是 readonly）：Element Plus 的表格 `data` 收的是可變陣列。
): RecordDisplayRow[] =>
  records.map((record) => {
    const cells: Record<string, string> = { rowKey: record.recordKey }
    for (const column of columns) cells[column.key] = column.read(record.data)
    // `cells` 一定含 `rowKey`（上一行就放進去了），但那件事型別系統看不出來，
    // 所以在這裡明寫一次而不是靠 `as`。
    return { ...cells, rowKey: record.recordKey }
  })
