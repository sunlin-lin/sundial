/**
 * `company-users` 大目錄的唯一對外出口（§0.3）。
 *
 * **只 re-export，沒有任何宣告或函式本體**，且**只 export service 與 errors**：
 * re-export repository 會讓跨模組的一行 import 把資料庫連線一起拖進來，
 * §4.2「裸 db client 限資料存取層」那條規則會被繞過，而繞過的路徑在 import 語句上完全看不出來。
 * routes 由組裝點（`app/routes.ts`）直接掛載，不從這裡流出去。
 *
 * `main` 次目錄目前只有 {@link deactivateCompanyUser} 一支（實作計畫 `plans/05-employee-
 * onboarding.md` §7：離職時同步停用帳號，但不刪除帳號與角色歷史），供 `employments/main` 的
 * 離職動作呼叫。員工帳號的其餘動作（建立、重設密碼）留到之後的階段。
 */
export { deactivateCompanyUser, type CompanyUserDeactivation } from './main/company-users-main.service.ts'
export {
  assignRoles,
  listPermissionCodes,
  listRoleAssignments,
  revokeRoles,
  type AssignedRole,
  type QueryRunner,
  type RoleAssignmentContext,
  type RoleAssignmentInput,
  type RoleAssignmentListItem,
  type RoleAssignmentPage,
  type RoleAssignmentQuery,
  type RoleAssignmentQueryContext,
  type RoleAssignmentSnapshot,
} from './roles/company-users-roles.service.ts'
export {
  companyUserInactive,
  companyUserNotFound,
  assignmentNotFound,
  assignmentStateChanged,
  lastRoleRequired,
  roleAlreadyAssigned,
  roleInactive,
  roleNotFound,
  RoleAssignmentErrorCode,
  COMPANY_USERS_ROLES_CREATE_ERROR_CODES,
  COMPANY_USERS_ROLES_LIST_ERROR_CODES,
  COMPANY_USERS_ROLES_REVOKE_ERROR_CODES,
} from './roles/company-users-roles.errors.ts'
