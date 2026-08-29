/**
 * 動作可用性（前端規範 §1.3 第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 這一頁唯一的動作是「新增員工」按鈕，導向 `employees/onboarding` 頁（`.page.vue` 檔頭）。
 * 判斷用的是**新增頁自己的權限碼**（`employees.onboarding.create`），不是這一頁的 `employees.main.list`
 * ——按鈕會不會出現，取決於使用者進去之後能不能真的建立員工，而不是他有沒有看清單的權限。
 */
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'

type Can = (code: PermissionCode) => boolean

export const canCreateEmployee = (can: Can): boolean => can('employees.onboarding.create')
