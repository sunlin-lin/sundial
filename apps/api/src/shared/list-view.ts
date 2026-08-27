/**
 * 列表端點的共用組裝（§1.4、§1.8.1）。
 *
 * §1.8.1 明文要求「list 端點的 `search`／`sort` 回聲**必須由共用的 list 組裝函式**從 request 帶回，
 * 禁止各端點自行填」，理由是這兩段**是最常被忘記填的東西**——留成空物件時後端不會錯、
 * 測試若只斷言 `data.data` 也不會紅，但前端的 race condition 防護（前端規範 §7.3）當場失效，
 * 而且是靜默失效。交給共用函式，就沒有「忘記」這個選項。
 *
 * 本檔在第二個列表端點（`employees/main/list`）落地時建立：
 * `shared/` 只在兩個以上使用者真的共用時才建（§0.1），一個列表端點時它還不該存在。
 *
 * TODO(下一個 PR): `modules/roles/main/domain/role-list-view.ts` 的 `toRoleListView` 與
 * `toKeywordPattern` 是本檔的先行複本，該檔自己的註解也寫明「出現第二個列表端點時應該升格到
 * `shared/`」。本次不得修改 roles 模組，故未一併遷移——roles 應改為引用本檔，然後刪掉那兩支。
 */

/**
 * 分頁資訊。**刻意不含總頁數**（§1.4）：前端由 `totalCount / perPage` 自行計算。
 *
 * 本檔的型別**刻意不加 `readonly`**（與跨層傳遞的業務型別相反）：這是端點 `data` 的形狀，
 * 而 Elysia 會拿路由 `response` schema 推出來的靜態型別去比對 handler 的回傳值，
 * 那個型別是可變的——加了 `readonly` 每一支列表端點都會是型別錯誤，而唯一的修法是 `as`（§2.2 禁止）。
 */
export type PaginationView = {
  currentPage: number
  perPage: number
  totalCount: number
}

/** 排序條件。`field` 是 API 對外欄位名（camelCase），不是資料庫欄位名。 */
export type SortView = {
  field: string
  order: 'asc' | 'desc'
}

/** 列表端點 `data` 的外殼（§1.4：實際清單在 `data.data`）。 */
export type ListView<TSearch, TItem> = {
  search: TSearch
  sort: SortView
  pagination: PaginationView
  data: TItem[]
}

/**
 * 組出列表端點的 `data`。
 *
 * @param search 使用者送來的搜尋條件，**原樣回聲**。
 * @param sort **實際生效**的排序（已補上預設值），不是「使用者送來的」——使用者沒送 `sort` 時
 *   回一個空的排序，前端就無從比對這包回應是不是自己現在畫面上這組條件的結果。
 * @param data 展開成可變陣列：業務型別刻意是 readonly（跨層傳遞時不該被改），
 *   對外的 `data` 則是一份新的拷貝。
 */
export const toListView = <TSearch, TItem>(
  search: TSearch,
  sort: SortView,
  pagination: PaginationView,
  data: readonly TItem[],
): ListView<TSearch, TItem> => ({ search, sort, pagination, data: [...data] })

/**
 * 把關鍵字轉成 `LIKE` 樣式。
 *
 * **必須先跳脫 `%`／`_`／`\`**：不跳脫的話，使用者輸入一個 `%` 就等於查詢全部資料，
 * 而輸入 `%%%%%` 這種字串會讓 MariaDB 做代價極高的回溯比對——兩者都不會報錯，只會慢，
 * 而且是在資料長大之後才慢。
 */
export const toKeywordPattern = (keyword: string): string => `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
