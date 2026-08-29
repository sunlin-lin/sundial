/**
 * 任職列表的條件收斂（零 IO 純函式，§1.4）。形狀與理由比照 `employees/main/domain/
 * employee-list-view.ts`，不重述。
 */
import type { EmploymentSortOption } from './employment-model.ts'

/** 允許排序的欄位白名單（API 對外欄位名，camelCase）。 */
export const EMPLOYMENT_SORT_FIELDS = ['hireDate', 'updatedAt'] as const

/** 未指定排序時的預設：依到職日新到舊——最常見的用途是「看最近到職的人」。 */
export const DEFAULT_EMPLOYMENT_SORT: EmploymentSortOption = { field: 'hireDate', order: 'desc' }

export const resolveEmploymentSort = (sort: EmploymentSortOption | undefined): EmploymentSortOption =>
  sort ?? DEFAULT_EMPLOYMENT_SORT
