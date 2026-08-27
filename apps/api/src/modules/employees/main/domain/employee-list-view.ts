/**
 * 員工列表的條件收斂（零 IO 純函式，§1.4）。
 *
 * 回應的外殼由 `shared/list-view.ts` 的共用組裝函式產生（§1.8.1 要求共用），本檔只放
 * 「員工這個實體特有」的部分：可以依哪些欄位排序、沒指定時預設排哪一欄。
 */
import type { EmployeeSortOption } from './employee-model.ts'

/**
 * 允許排序的欄位白名單（API 對外欄位名，camelCase）。
 *
 * 白名單是必要的，不是保守：把 `sort.field` 的字串直接接進 SQL 等於同時開放 SQL injection
 * 與全表掃描（§1.4）。這份常數同時餵給路由的 schema（擋在驗證層）與 repository 的欄位對照
 * （擋在查詢層），兩邊用同一份來源才不會出現「schema 允許但查詢不認得」的欄位。
 *
 * **清單裡沒有任何加密欄位**（身分證、生日、電話、Email、地址）：那些欄位在資料庫裡是密文，
 * 依它們排序等於依密文的位元組排序，結果毫無意義卻看起來像排好了。
 */
export const EMPLOYEE_SORT_FIELDS = ['employeeCode', 'name', 'createdAt', 'updatedAt'] as const

/**
 * 未指定排序時的預設。
 *
 * 選 `employeeCode` 而不是 `createdAt`：員工清單是人事天天看的固定清單，依編號排序的順序
 * 是穩定且可預期的（而且編號本身多半就帶著部門或到職梯次的意義）；
 * 依建立時間排序會讓新增一位員工就把整個清單重排，使用者每次打開看到的位置都不一樣。
 */
export const DEFAULT_EMPLOYEE_SORT: EmployeeSortOption = { field: 'employeeCode', order: 'asc' }

/**
 * 補上預設排序。
 *
 * 回傳值同時用於查詢與**回聲**（§1.4）：回聲的必須是「實際生效的排序」而不是「使用者送來的」，
 * 否則前端拿回一個空的 `sort`，無從比對這包回應是不是自己現在畫面上這組條件的結果。
 */
export const resolveEmployeeSort = (sort: EmployeeSortOption | undefined): EmployeeSortOption =>
  sort ?? DEFAULT_EMPLOYEE_SORT
