/**
 * 列表端點的條件收斂與回應組裝（零 IO 純函式，§1.4）。
 */
import type { RoleListQuery, RoleSortOption } from './role-model.ts'

/**
 * 允許排序的欄位白名單（API 對外欄位名，camelCase）。
 *
 * 白名單是必要的，不是保守：把 `sort.field` 的字串直接接進 SQL 等於同時開放 SQL injection
 * 與全表掃描（§1.4）。這份常數同時餵給路由的 schema（擋在驗證層）與 repository 的欄位對照
 * （擋在查詢層），兩邊用同一份來源才不會出現「schema 允許但查詢不認得」的欄位。
 */
export const ROLE_SORT_FIELDS = ['code', 'name', 'status', 'createdAt', 'updatedAt'] as const

/**
 * 未指定排序時的預設。
 *
 * 選 `code` 而不是 `createdAt`：角色清單是使用者天天看的固定清單，依代碼排序的順序是穩定且可預期的；
 * 依建立時間排序會讓新增一個角色就把整個清單重排，使用者每次打開看到的位置都不一樣。
 */
export const DEFAULT_ROLE_SORT: RoleSortOption = { field: 'code', order: 'asc' }

/**
 * 補上預設排序。
 *
 * 回傳值同時用於查詢與**回聲**（§1.4）：回聲的必須是「實際生效的排序」而不是「使用者送來的」，
 * 否則前端拿回一個空的 `sort`，無從比對這包回應是不是自己現在畫面上這組條件的結果。
 */
export const resolveRoleSort = (sort: RoleSortOption | undefined): RoleSortOption => sort ?? DEFAULT_ROLE_SORT

/**
 * 把關鍵字轉成 `LIKE` 樣式。
 *
 * **必須先跳脫 `%`／`_`／`\`**：不跳脫的話，使用者輸入一個 `%` 就等於查詢全部資料，
 * 而輸入 `%%%%%` 這種字串會讓 MariaDB 做代價極高的回溯比對——兩者都不會報錯，只會慢，
 * 而且是在資料長大之後才慢。
 */
export const toKeywordPattern = (keyword: string): string => `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/**
 * 列表端點 `data` 的外殼（§1.4：實際清單在 `data.data`）。
 *
 * `search` 與 `sort` 由本函式從查詢條件帶回，**不讓各端點自己填**（§1.8.1）：這兩段是最容易被忘記
 * 填的東西——留成空物件時後端不會錯、測試若只斷言 `data.data` 也不會紅，但前端的
 * race condition 防護當場失效，而且是靜默失效。
 *
 * 註：§1.8.1 要求的是一個**共用**的 list 組裝函式。目前骨架的 `shared/` 只提供了 schema
 * （`paginationResponse`），沒有對應的執行期組裝函式，因此先落在本模組；出現第二個列表端點時
 * 應該升格到 `shared/`（已寫進交付回報）。
 */
export const toRoleListView = <TSearch, TItem>(
  query: RoleListQuery,
  search: TSearch,
  totalCount: number,
  data: TItem[],
): {
  search: TSearch
  sort: RoleSortOption
  pagination: { currentPage: number; perPage: number; totalCount: number }
  data: TItem[]
} => ({
  search,
  sort: query.sort,
  pagination: { currentPage: query.currentPage, perPage: query.perPage, totalCount },
  data,
})
