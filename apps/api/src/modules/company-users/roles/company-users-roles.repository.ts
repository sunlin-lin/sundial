/**
 * `company-users/roles` 的資料存取入口（§0.4）。
 *
 * 每個動作一個函式、每個函式只有一行委派，**簽章寫在這裡**：入口存在的目的是
 * 「打開它就知道這裡有哪些動作、各自收什麼、回什麼，一頁看完」。
 *
 * 動作的單位是**資料存取動作，不是端點動作**（§0.4）：`listActiveAssignments` 一支就同時
 * 服務指派、撤銷與兩支端點的回傳值，既不需要複製，切片之間也不需要互相依賴。
 *
 * 依 §0.3，本檔**不得被本次目錄以外的任何檔案 import**——跨次目錄要資料一律走 service，
 * 否則本次目錄的規則（有效指派的定義、公司範圍、軟刪除過濾）會被整組繞過。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { CompanyUserState, RoleState } from './domain/role-assignment-plan.ts'
import { findCompanyUserForUpdate as findCompanyUserForUpdateImpl } from './impl/company-users-roles.find-company-user.repository.ts'
import { findRolesByIds as findRolesByIdsImpl } from './impl/company-users-roles.find-roles.repository.ts'
import {
  listActiveAssignments as listActiveAssignmentsImpl,
  type ActiveAssignmentRow,
} from './impl/company-users-roles.list-active-assignments.repository.ts'
import {
  insertAssignments as insertAssignmentsImpl,
  type NewAssignment,
} from './impl/company-users-roles.insert-assignments.repository.ts'
import {
  listAssignmentPage as listAssignmentPageImpl,
  type AssignmentPage,
  type AssignmentPageCriteria,
  type AssignmentRow,
} from './impl/company-users-roles.list-page.repository.ts'
import { listPermissionCodes as listPermissionCodesImpl } from './impl/company-users-roles.list-permission-codes.repository.ts'
import {
  revokeAssignments as revokeAssignmentsImpl,
  type Revocation,
} from './impl/company-users-roles.revoke-assignments.repository.ts'

export type { ActiveAssignmentRow, AssignmentPage, AssignmentPageCriteria, AssignmentRow, NewAssignment, Revocation }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。
 *
 * 原本這裡宣告的是一份刻意不含 `delete` 的窄型別，理由是「本次目錄的每一列都是稽核事實，
 * 型別上拿不到 delete，順手刪一下就寫不出來」。那個理由本身沒錯，但**它擋的東西與它的代價不成比例**：
 * 窄化之後 runner 交不進 `TenantDatabase`，於是本目錄的每一支查詢都改成裸 runner ＋ 手寫
 * `eq(table.companyId, companyId)`——擋掉了一個沒人會犯的錯（在稽核表上呼叫 delete），
 * 換來一個會出事的錯（某一支 join 漏了公司條件，且不會有任何地方變紅）。
 * 「不得實體刪除稽核資料」回到 §4.3 與 review 去守，那本來就是資料語意的規則，不是型別的規則。
 */
export type { QueryRunner }

/** 分頁查詢角色指派紀錄，連同套用相同條件的總筆數。 */
export const listAssignmentPage = (
  runner: QueryRunner,
  companyId: string,
  criteria: AssignmentPageCriteria,
): Promise<AssignmentPage> => listAssignmentPageImpl(runner, companyId, criteria)

/** 在交易內鎖定並讀取一位公司成員；查無此人（含屬於別家公司）回 `null`。 */
export const findCompanyUserForUpdate = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<CompanyUserState | null> => findCompanyUserForUpdateImpl(runner, companyId, companyUserId)

/** 依 id 批次取出本公司未軟刪除的角色現況。 */
export const findRolesByIds = (
  runner: QueryRunner,
  companyId: string,
  roleIds: readonly string[],
): Promise<ReadonlyMap<string, RoleState>> => findRolesByIdsImpl(runner, companyId, roleIds)

/** 讀取一位成員目前仍有效的角色指派（未撤銷且角色未刪除）。 */
export const listActiveAssignments = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<readonly ActiveAssignmentRow[]> => listActiveAssignmentsImpl(runner, companyId, companyUserId)

/** 批次寫入角色指派。 */
export const insertAssignments = (
  runner: QueryRunner,
  companyId: string,
  assignments: readonly NewAssignment[],
): Promise<void> => insertAssignmentsImpl(runner, companyId, assignments)

/** 條件式批次撤銷，回傳實際影響的列數（§4.4）。 */
export const revokeAssignments = (
  runner: QueryRunner,
  companyId: string,
  assignmentIds: readonly string[],
  revocation: Revocation,
): Promise<number> => revokeAssignmentsImpl(runner, companyId, assignmentIds, revocation)

/** 查出一位成員目前實際擁有的權限碼；授權判定的唯一依據。 */
export const listPermissionCodes = (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<ReadonlySet<string>> => listPermissionCodesImpl(runner, companyId, companyUserId)
