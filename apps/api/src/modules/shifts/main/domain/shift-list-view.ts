/**
 * 班別列表的條件收斂（零 IO 純函式，§1.4）。
 *
 * 回應的外殼由 `shared/list-view.ts` 的共用組裝函式產生（§1.8.1 要求共用），本檔只放
 * 「班別這個實體特有」的部分：可以依哪些欄位排序、沒指定時預設排哪一欄。
 */
import type { ShiftSortOption } from './shift-model.ts'

/**
 * 允許排序的欄位白名單（API 對外欄位名，camelCase）。
 *
 * 白名單是必要的，不是保守：把 `sort.field` 的字串直接接進 SQL 等於同時開放 SQL injection
 * 與全表掃描（§1.4）。這份常數同時餵給路由的 schema（擋在驗證層）與 repository 的欄位對照
 * （擋在查詢層），兩邊用同一份來源才不會出現「schema 允許但查詢不認得」的欄位。
 */
export const SHIFT_SORT_FIELDS = ['code', 'name', 'createdAt', 'updatedAt'] as const

/**
 * 未指定排序時的預設。
 *
 * 選 `code` 而不是 `createdAt`：班別代碼是人資設定畫面上天天照著唸的識別字串，依代碼排序的
 * 順序穩定且可預期；依建立時間排序會讓「停用舊的、複製建立新的」（計畫 §7）這個日常流程每做一次
 * 就把整個清單重排一次。
 */
export const DEFAULT_SHIFT_SORT: ShiftSortOption = { field: 'code', order: 'asc' }

/**
 * 補上預設排序。
 *
 * 回傳值同時用於查詢與**回聲**（§1.4）：回聲的必須是「實際生效的排序」而不是「使用者送來的」，
 * 否則前端拿回一個空的 `sort`，無從比對這包回應是不是自己現在畫面上這組條件的結果。
 */
export const resolveShiftSort = (sort: ShiftSortOption | undefined): ShiftSortOption => sort ?? DEFAULT_SHIFT_SORT
