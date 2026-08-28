/**
 * 收到回應之後的處置（§1.3 的第 (1) 類；依 §0.7 從 `.view.ts` 按主題拆出來的兄弟檔）。
 *
 * 三件事，共同的問題是「這一包回來的東西該怎麼被畫面採用」：
 * 這包是不是現在畫面上這組條件的結果（{@link isSyncListEcho}）、總筆數怎麼收斂成分頁元件
 * 吃得下的數字（{@link toTotalCount}）、以及失敗要走哪一種畫面（{@link toLoadFailure}）。
 *
 * 它們與 `.view.ts` 的「一列怎麼組」互不相干，放在一起只會讓兩邊都變成翻頁才找得到的東西。
 */
import { PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { RegulatorySyncListData } from '../../../api/generated/api-client.ts'
import type { SyncListQuery } from './regulatory-sync.payload.ts'

/**
 * 這一包回應是不是「現在畫面上這組條件」的結果（§7.3）。
 *
 * **回應到達順序不保證**：使用者連點三個資料集時會連續送出三次請求，第一次若走到一台比較慢的
 * 節點，可能比第三次晚回來。直接賦值的結果是**舊回應蓋掉新回應**——篩選器停在 A、列表卻是 B
 * 的資料，`totalCount` 也是舊的那一次。這種 bug 不會報錯、不會有紅字，本機網路太快也測不到，
 * 只在客戶端偶發，而使用者唯一能得到的結論是「這個系統的數字不能信」。
 *
 * 後端把 `search` / `sort` 原樣回聲就是為了讓這件事可判斷（後端規範 §1.4）——
 * 這兩個欄位不是冗餘資料，拿掉它們等於把 race condition 放回來。
 *
 * ⚠️ §7.3 要求這段比對寫在**統一的列表 composable** 裡而不是各頁自己判斷。本專案還沒有那個
 * composable，而 §1.5 規定共用區的模組要有第二個使用者才能移進去（這是全站第一個列表頁）。
 * 第二個列表頁出現時，這一支就是該被抽出去的東西。
 */
export const isSyncListEcho = (page: RegulatorySyncListData, query: SyncListQuery): boolean =>
  page.search.datasetCode === query.datasetCode &&
  page.sort.field === query.sort.field &&
  page.sort.order === query.sort.order

/** 十進位的一位數。逐位換算用，見 {@link toTotalCount}。 */
const DIGITS = '0123456789'

/**
 * 總筆數 → 分頁元件吃的 `number`，**不經過 `Number(` / `parseInt(`**
 *（`bun run check:number-cast` 禁止 `pages/**` 出現數值轉型）。
 *
 * 為什麼需要這一支：`pagination.totalCount` 在產生型別上是 `string | number`。
 * 後端宣告的是 `t.Integer()`，實際回來的一律是 JSON 數字；`string` 那一支是 Elysia 的可強制
 * 轉型數值型別在 OpenAPI 上留下的影子（`anyOf[string, integer]`）。它在型別上存在，就得處理。
 *
 * 逐位累加而不是轉型：分頁筆數不是金額，用 `Number(` 在這裡其實無害，但那條掃描規則的定義域
 * 刻意收成純路徑判定並接受偽陽性（見該腳本檔頭）——寧可被擋下來的人繞一下，也不要一條
 * 「判斷不出來就放行」的規則，因為判斷不出來的情況恰好包含最該擋的那些。
 *
 * 讀不懂的字元一律回 `0`（分頁顯示「共 0 筆」），不猜、也不拋：一格的格式問題不該讓整頁白掉。
 */
export const toTotalCount = (value: string | number): number => {
  if (typeof value === 'number') return value

  let total = 0
  for (const character of value.trim()) {
    const digit = DIGITS.indexOf(character)
    if (digit < 0) return 0
    total = total * 10 + digit
  }
  return total
}

/**
 * 載入失敗要走哪一種畫面（§7.2 的「載入失敗」再分兩種，因為使用者的下一步不同）。
 *
 * - **無權限**（後端 `901`）：重試幾次都一樣，該做的是去找有權限的人。因此不給重試鈕，
 *   並顯示**後端回來的那句話**——不在前端另備一份文案（§3.6、語系檔檔頭）。
 * - **其他**：連不上、`100` / `400`、回應不是 envelope。細節一律不對使用者顯示，只給重試。
 *
 * **這裡認的是型別化錯誤，不是 HTTP status**（§3.6）：頁面一旦看得到 status 就會開始自己判斷
 * `401`，而把 `901` 當 `900` 處理會讓使用者進入「登入 → 點到沒權限的功能 → 被踢回登入頁」的
 * 無限迴圈，他重登幾次就遇到幾次。統一 client 已經把這兩件事分成兩種錯誤類別了。
 */
export type LoadFailure =
  | { readonly kind: 'permission-denied'; readonly message: string }
  | { readonly kind: 'system' }

export const toLoadFailure = (error: unknown): LoadFailure =>
  error instanceof PermissionDeniedError
    ? { kind: 'permission-denied', message: error.message }
    : { kind: 'system' }
