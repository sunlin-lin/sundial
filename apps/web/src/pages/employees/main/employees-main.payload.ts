/**
 * 查詢條件 → 送給後端的 `list` 參數（前端規範 §1.3 第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * **UI 定案 §1 的查詢條件是「員工編號或姓名、部門、任職狀態、帳號狀態」四項，這裡只做得出第一項。**
 * `POST /employees/main/list` 的 request schema（`employees-main.routes.ts`）只收 `keyword`——
 * 沒有 `departmentId`／任職狀態／帳號狀態任何一個篩選欄位，也沒有查詢端能補這個缺口
 * （`.view.ts` 檔頭已說明回應本身也沒有這幾欄可顯示）。本檔不虛構這三個條件，
 * 只組裝後端真的認得的 `keyword`＋分頁＋固定排序。
 */
import type { EmployeesMainListInput } from '../../../api/generated/api-client.ts'

export type EmployeeListFilters = {
  keyword: string
}

export const defaultEmployeeListFilters = (): EmployeeListFilters => ({ keyword: '' })

export type EmployeeListQuery = EmployeesMainListInput & { readonly sort: NonNullable<EmployeesMainListInput['sort']> }

export const EMPLOYEE_LIST_PER_PAGE = 20

/** 與後端 `DEFAULT_EMPLOYEE_SORT`（`employee-list-view.ts`）一致：依員工編號由小到大。 */
export const EMPLOYEE_LIST_SORT = { field: 'employeeCode', order: 'asc' } as const

/** 用展開式**省略**沒帶的條件，不是設成 `undefined`——`exactOptionalPropertyTypes` 底下兩者是不同形狀。 */
export const toEmployeeListQuery = (filters: EmployeeListFilters, currentPage: number): EmployeeListQuery => {
  const keyword = filters.keyword.trim()

  return {
    ...(keyword === '' ? {} : { keyword }),
    currentPage,
    perPage: EMPLOYEE_LIST_PER_PAGE,
    sort: EMPLOYEE_LIST_SORT,
  }
}
