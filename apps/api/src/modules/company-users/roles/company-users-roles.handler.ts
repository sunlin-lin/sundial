/**
 * `company-users/roles` 的端點 handler（§0.4：handler 不拆）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把結果收成本端點的 `data` 形狀（§1.8.0 的④與⑥）。三種形狀刻意不共用型別：
 * 共用之後，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變。
 *
 * **不自行設定 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不自行組 `errors`**
 * （§1.8.2）：成功走 `ok()`，失敗整包交給邊界層的錯誤映射，兩條路徑最後走同一個出口（§1.8.4）。
 *
 * 請求與回應的型別在**本檔**宣告、由 `*.routes.ts` import，不是反過來：routes 已經 import
 * 本檔的 handler 函式，兩邊互相 import 會形成循環相依。routes 那邊的 TypeBox schema 是同一組
 * 形狀的執行期版本，兩者對不上時 TypeScript 會在 routes 的回傳值檢查上當場報錯。
 */
import { resolveServiceResult, type BoundaryResponse } from '../../../http/error-boundary.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { Clock } from '../../../shared/clock.ts'
import type { Database } from '../../../db/client.ts'
import { ok, type EnvelopeBody } from '../../../shared/envelope.ts'
import type { RoleAssignmentSnapshot } from './domain/role-assignment-model.ts'
import { DEFAULT_ASSIGNMENT_SORT, type AssignmentSort } from './domain/role-assignment-sort.ts'
import { assignRoles, listRoleAssignments, revokeRoles } from './company-users-roles.service.ts'

/**
 * 由組裝點注入的相依。
 *
 * **公司範圍不在裡面**——它只能來自每一次請求的已驗證身分（§4.2），
 * 放進這裡就變成整個服務共用一個值，那正是跨公司外洩的形狀。
 */
export type CompanyUsersRolesDependencies = {
  readonly database: Database
  readonly clock: Clock
}

/** 清單端點的 request（只列 handler 真的會用到的欄位；`rqTS`／`cmd`／`locale` 由出入口層處理）。 */
export type RoleAssignmentListRequest = {
  readonly companyUserId?: string
  readonly roleId?: string
  readonly includeRevoked: boolean
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: AssignmentSort
}

/** 指派／撤銷端點的 request。兩支的形狀相同，差別只在動作。 */
export type RoleAssignmentChangeRequest = {
  readonly companyUserId: string
  readonly roleIds: readonly string[]
}

/** 搜尋條件的回聲（§1.4）。 */
export type RoleAssignmentSearchView = {
  readonly companyUserId?: string
  readonly roleId?: string
  readonly includeRevoked: boolean
}

export type RoleAssignmentItemView = {
  readonly id: string
  readonly companyUserId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly assignedAt: string
  readonly assignedByName: string
  readonly revokedAt: string | null
  readonly revokedByName: string | null
}

export type RoleAssignmentListView = {
  readonly search: RoleAssignmentSearchView
  readonly sort: AssignmentSort
  readonly pagination: {
    readonly currentPage: number
    readonly perPage: number
    readonly totalCount: number
  }
  /** 實際清單在 `data.data`（§1.4）；禁止裸陣列，否則之後要加分頁資訊就是破壞性改版。 */
  readonly data: RoleAssignmentItemView[]
}

export type AssignedRoleView = {
  readonly assignmentId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly assignedAt: string
}

export type RoleAssignmentSnapshotView = {
  readonly companyUserId: string
  readonly roles: AssignedRoleView[]
}

/**
 * 只回聲**使用者真的送來的**欄位：沒送的欄位若被補成 `null`，前端拿回聲比對自己畫面上的
 * 條件時會比不中，而它的用途正是判斷「這包回應是不是我現在這組條件的結果」。
 */
const toSearchView = (request: RoleAssignmentListRequest): RoleAssignmentSearchView => ({
  ...(request.companyUserId === undefined ? {} : { companyUserId: request.companyUserId }),
  ...(request.roleId === undefined ? {} : { roleId: request.roleId }),
  includeRevoked: request.includeRevoked,
})

/** service 的結果 → 狀態變更端點的 `data`。逐欄寫出來，不把 service 的回傳值直接指派給 `data`（§2）。 */
const toSnapshotView = (snapshot: RoleAssignmentSnapshot): RoleAssignmentSnapshotView => ({
  companyUserId: snapshot.companyUserId,
  roles: snapshot.roles.map((role) => ({
    assignmentId: role.assignmentId,
    roleId: role.roleId,
    roleCode: role.roleCode,
    roleName: role.roleName,
    assignedAt: role.assignedAt,
  })),
})

/**
 * `POST /company-users/roles/list`。
 *
 * 公司範圍取自已驗證的身分，**不從 body 拿**（§4.2）。因此「以 B 公司身分查 A 公司的成員」
 * 與「查一個不存在的成員」得到的都是空清單（§3.2）——兩者走的是同一行程式碼。
 */
export const listRoleAssignmentsHandler = async (
  dependencies: CompanyUsersRolesDependencies,
  identity: VerifiedIdentity,
  request: RoleAssignmentListRequest,
): Promise<EnvelopeBody<RoleAssignmentListView>> => {
  // 未指定排序時用預設值，而且**回聲的是套用後的值**：回聲 `undefined` 的話，
  // 前端無從得知這頁資料實際是照什麼排的，而分頁往下翻時它需要知道。
  const sort = request.sort ?? DEFAULT_ASSIGNMENT_SORT

  const page = await listRoleAssignments(
    { database: dependencies.database, companyId: identity.companyId },
    {
      companyUserId: request.companyUserId ?? null,
      roleId: request.roleId ?? null,
      includeRevoked: request.includeRevoked,
      perPage: request.perPage,
      currentPage: request.currentPage,
      sort,
    },
  )

  return ok({
    search: toSearchView(request),
    sort,
    pagination: {
      currentPage: request.currentPage,
      perPage: request.perPage,
      totalCount: page.totalCount,
    },
    data: page.items.map((item) => ({
      id: item.id,
      companyUserId: item.companyUserId,
      roleId: item.roleId,
      roleCode: item.roleCode,
      roleName: item.roleName,
      assignedAt: item.assignedAt,
      assignedByName: item.assignedByName,
      revokedAt: item.revokedAt,
      revokedByName: item.revokedByName,
    })),
  })
}

/** `POST /company-users/roles/create`。 */
export const createRoleAssignmentsHandler = async (
  dependencies: CompanyUsersRolesDependencies,
  identity: VerifiedIdentity,
  request: RoleAssignmentChangeRequest,
): Promise<BoundaryResponse<RoleAssignmentSnapshotView> | BoundaryResponse<null>> => {
  const result = await assignRoles(
    {
      database: dependencies.database,
      clock: dependencies.clock,
      companyId: identity.companyId,
      // 指派者是「現在按下按鈕的人」，一律由 token 推導，不信任請求帶來的識別碼（§5.2）。
      operatorCompanyUserId: identity.companyUserId,
    },
    { companyUserId: request.companyUserId, roleIds: request.roleIds },
  )

  return resolveServiceResult(result, toSnapshotView)
}

/** `POST /company-users/roles/revoke`。 */
export const revokeRoleAssignmentsHandler = async (
  dependencies: CompanyUsersRolesDependencies,
  identity: VerifiedIdentity,
  request: RoleAssignmentChangeRequest,
): Promise<BoundaryResponse<RoleAssignmentSnapshotView> | BoundaryResponse<null>> => {
  const result = await revokeRoles(
    {
      database: dependencies.database,
      clock: dependencies.clock,
      companyId: identity.companyId,
      operatorCompanyUserId: identity.companyUserId,
    },
    { companyUserId: request.companyUserId, roleIds: request.roleIds },
  )

  return resolveServiceResult(result, toSnapshotView)
}
