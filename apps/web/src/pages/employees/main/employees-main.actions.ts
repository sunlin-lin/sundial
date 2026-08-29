/**
 * 動作可用性（前端規範 §1.3 第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 這一頁有兩個動作：「新增員工」導向 `employees/onboarding` 頁，「查看並修改」導向
 * `employees/detail` 頁（計畫 05 Stage 6 第二段）。兩者都判斷**目的頁自己的權限碼**
 * （`employees.onboarding.create`／`employees.main.get`），不是這一頁的 `employees.main.list`
 * ——按鈕會不會出現，取決於使用者進去之後能不能真的做那件事，而不是他有沒有看清單的權限。
 */
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'

type Can = (code: PermissionCode) => boolean

export const canCreateEmployee = (can: Can): boolean => can('employees.onboarding.create')

/** 對到 `employees/detail` 的 `meta.permission`（該頁的 `.route.ts`）。 */
export const canViewEmployeeDetail = (can: Can): boolean => can('employees.main.get')
