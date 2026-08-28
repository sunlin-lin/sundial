/**
 * list 回應的回聲比對（前端規範 §7.3）。
 *
 * ## 這一段擋的是什麼
 *
 * **回應到達順序不保證。** 使用者連點三個篩選條件時會連續送出三次請求，第一次若走到一台比較慢的
 * 節點，可能比第三次晚回來。直接賦值的結果是**舊回應蓋掉新回應**——篩選器停在 A、列表卻是 B 的
 * 資料，`totalCount` 也是舊的那一次。這種 bug 不會報錯、不會有紅字，本機網路太快也測不到，
 * 只在客戶端偶發，而使用者唯一能得到的結論是「這個系統的數字不能信」。
 *
 * 後端把 `search` / `sort` 原樣回聲就是為了讓這件事可判斷（後端規範 §1.4）——
 * 這兩個欄位不是冗餘資料，拿掉它們等於把 race condition 放回來。
 *
 * ## 為什麼現在才搬進 `shared/`
 *
 * §7.3 要求這段比對寫在**統一的地方**而不是各頁自己判斷，但 §1.5 要求共用區的模組先有第二個
 * 使用者。第一個列表頁（`regulatory/sync`）出現時只有一個使用者，所以它留在頁面目錄裡，
 * 並在檔頭寫下「第二個列表頁出現時，這一支就是該被抽出去的東西」。
 * 第二個列表頁（`regulatory/datasets` 的版本清單）到了，所以搬過來。
 *
 * 兩頁的回應形狀本來就一樣——`search` ＋ `sort` ＋ `pagination` ＋ `data` 是 §7.1 釘死的欄位名，
 * 全站所有列表共用同一組。抽出來之後這一段不再是「每一頁記得要做的事」，而是列表回應的處置本身。
 *
 * ## 為什麼是純函式而不是 composable
 *
 * §7.3 的用詞是「統一的列表 composable」，但本檔刻意只做那個 composable 裡**唯一有判斷的那一段**。
 * 一個把 `rows` / `pagination` / `loading` / `error` 全包起來的 composable 需要先決定四態怎麼呈現、
 * 失敗怎麼分流、篩選條件長什麼形狀——而這兩頁在這幾件事上並不相同（一頁的失敗要分「無權限」與
 * 「其他」，另一頁還要處理三層展開）。硬抽一個共用殼會立刻開始長 `mode` 參數（§1.5 的理由）。
 * 回聲比對則是兩頁**逐字相同**的那一段，而且它是純函式，可以逐格測（§8.1）。
 *
 * ## 為什麼放在 `shared/api/`
 *
 * 它處理的是「API 回來的一包東西該不該被採用」，與 `client.ts` 的 envelope 拆解、
 * `api-error.ts` 的錯誤分類是同一類問題（回應的處置），不是版面或格式化。
 */
import { isRecord } from './record-shape.ts'

/** 列表回應的排序回聲（§7.1：單欄，不支援多欄）。 */
export type ListSort = {
  readonly field: string
  readonly order: string
}

/**
 * 回聲比對只看得到的那兩個欄位。
 *
 * 刻意不要求整包 `data`（`pagination` / `data` 都用不到）：收窄成實際會讀的欄位之後，
 * 任何一支列表回應都套得進來，而不需要為每一頁各寫一個過載。
 */
export type ListEchoResponse<TSearch extends Readonly<Record<string, unknown>>> = {
  readonly search: TSearch
  readonly sort: ListSort
}

/**
 * 這一包回應是不是「現在畫面上這組條件」的結果。
 *
 * @param page 回應的 `search` / `sort` 回聲。
 * @param query **送出去的那一次查詢**。篩選條件平鋪在根層（§7.1），排序在 `sort`。
 *   型別上被 `TSearch &` 綁住：回應回聲了哪些欄位，查詢就必須有同名的欄位，
 *   否則編譯錯誤——少了這個約束，後端多回聲一個欄位時這裡會安靜地少比一項。
 *
 * 比對的是**回應回聲了什麼**（`page.search` 的每一個鍵），不是「查詢有哪些欄位」：
 * 查詢那一側還帶著 `currentPage` / `perPage`，而分頁不是回聲比對的對象（同一組條件翻頁時，
 * 回應的 `search` 完全相同，該被採用）。
 *
 * `Object.is` 而不是 `===`：值只會是後端回聲回來的純量（數字、字串、布林、`null`），
 * 兩者在這些值上的差別只有 `NaN` 與 `-0`——而在那兩個值上 `Object.is` 才是我們要的意思。
 */
export const isListEcho = <TSearch extends Readonly<Record<string, unknown>>>(
  page: ListEchoResponse<TSearch>,
  query: TSearch & { readonly sort: ListSort },
): boolean => {
  if (page.sort.field !== query.sort.field) return false
  if (page.sort.order !== query.sort.order) return false

  // 泛型參數不能直接用字串索引，`isRecord` 是把它收成可索引記錄的無 `as` 途徑（§3.2 禁止
  // 用 `as` 繞過型別）。它在這裡永遠為真——`TSearch` 的約束就是一個物件——所以 `false` 那一支
  // 不是防禦，而是型別收窄的副產物。
  if (!isRecord(query)) return false

  return Object.entries(page.search).every(([key, echoed]) => Object.is(query[key], echoed))
}
