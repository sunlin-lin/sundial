/**
 * `company-users/roles` 的業務入口（§0.4）。
 *
 * 四個動作，其中 {@link listPermissionCodes} **沒有對應的端點**：它的呼叫者是身分驗證
 * middleware（經由 `shared/access-control.ts` 的 `PermissionLookup` 注入），每個請求跑一次。
 * 沒有端點的業務動作一樣放入口——界線是「有沒有次目錄以外的呼叫者」，不是「前端打不打得到」。
 * 塞進 `impl/` 會繞過「所有呼叫必須經過入口」那道牆，塞進 middleware 則等於讓入口層直接碰 repository。
 *
 * 本層**不碰 envelope、不出現 HTTP 狀態碼與 `WebFlowCode`**（§1.8.2、§3.1.1）：
 * 那些是「Web 前端」這一種入口的東西，同一段規則被排程或匯入呼叫時根本沒有那包信封。
 *
 * 跨層型別定義在 `domain/role-assignment-model.ts`，本檔只 re-export：定義在這裡的話，
 * `impl/` 的切片要用它就得回頭 import 入口檔，形成循環相依。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type {
  RoleAssignmentContext,
  RoleAssignmentInput,
  RoleAssignmentPage,
  RoleAssignmentQuery,
  RoleAssignmentQueryContext,
  RoleAssignmentSnapshot,
} from './domain/role-assignment-model.ts'
import type { QueryRunner } from './company-users-roles.repository.ts'
import { assignRoles as assignRolesImpl } from './impl/company-users-roles.create.service.ts'
import { listRoleAssignments as listRoleAssignmentsImpl } from './impl/company-users-roles.list.service.ts'
import { listPermissionCodes as listPermissionCodesImpl } from './impl/company-users-roles.list-permission-codes.service.ts'
import { revokeRoles as revokeRolesImpl } from './impl/company-users-roles.revoke.service.ts'

export type {
  AssignedRole,
  RoleAssignmentContext,
  RoleAssignmentInput,
  RoleAssignmentListItem,
  RoleAssignmentPage,
  RoleAssignmentQuery,
  RoleAssignmentQueryContext,
  RoleAssignmentSnapshot,
} from './domain/role-assignment-model.ts'
export type { QueryRunner }

/**
 * 分頁查詢角色指派紀錄。
 *
 * **不回 `ServiceResult`**：查詢類端點沒有業務拒絕，「查無資料」是一個正常且有效的答案（§3.1.3）。
 * 跨公司查詢與查無資料一樣回空清單（§3.2）。
 */
export const listRoleAssignments = (
  context: RoleAssignmentQueryContext,
  query: RoleAssignmentQuery,
): Promise<RoleAssignmentPage> => listRoleAssignmentsImpl(context, query)

/** 指派一或多個角色，回傳變更後的全部有效角色。 */
export const assignRoles = (
  context: RoleAssignmentContext,
  input: RoleAssignmentInput,
): Promise<ServiceResult<RoleAssignmentSnapshot>> => assignRolesImpl(context, input)

/** 撤銷一或多個角色，回傳變更後的全部有效角色。 */
export const revokeRoles = (
  context: RoleAssignmentContext,
  input: RoleAssignmentInput,
): Promise<ServiceResult<RoleAssignmentSnapshot>> => revokeRolesImpl(context, input)

/**
 * 查出一位公司成員目前擁有的權限碼集合，供身分驗證 middleware 判斷授權。
 *
 * 簽章刻意與 `shared/access-control.ts` 的 `PermissionLookup` 對齊（多一個連線參數，
 * 由組裝點以閉包補上），讓入口層不必知道權限是怎麼存的。
 */
export const listPermissionCodes = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<ReadonlySet<string>> => listPermissionCodesImpl(runner, companyId, companyUserId)
