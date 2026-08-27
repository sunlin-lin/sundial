/**
 * 本次目錄跨層傳遞的型別（純型別，零執行期程式碼）。
 *
 * 為什麼放在 `domain/`：§0.2 的檔名白名單只允許 `routes`／`handler`／`service`／`repository`／
 * `errors`／`impl/`／`domain/`／`__tests__/`，**沒有一個「模組共用型別」的位置**。
 * 放進 service 入口檔會讓 `impl/` 的切片回頭 import 入口檔，形成循環相依；放進 repository 入口檔
 * 則要把 `clock` 塞進一個資料存取的型別裡。`domain/` 是唯一剩下的位置，而本檔只有型別、
 * 編譯後完全消失，仍然符合「零 IO」。（已寫進交付回報；`roles/main` 也是同樣的取捨。）
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'
import type { AssignmentSort } from './role-assignment-sort.ts'

/**
 * 會寫入資料的動作共用的相依。
 *
 * `companyId` 與 `operatorCompanyUserId` **只能來自已驗證的 token**（§4.2、§5.2），
 * 不得取自 request body——一旦公司來自客戶端，任何人改一個字串就能操作別家公司的帳號。
 */
export type RoleAssignmentContext = {
  /**
   * 資料庫連線。**交易邊界屬於 service**（§4.4），因此 service 拿到的是連線本身而不是交易物件
   * ——repository 不自開交易，否則巢狀時無法合併成一個原子操作。
   */
  readonly database: Database
  /** 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`，否則跨日與月底的邏輯無法測試。 */
  readonly clock: Clock
  readonly companyId: string
  /** 執行本次操作的人，會被寫進 `assigned_by`／`revoked_by` 這兩個稽核欄位（§5.3）。 */
  readonly operatorCompanyUserId: string
}

/** 查詢動作只需要連線與公司範圍：它不寫入，也就不需要時間與操作者。 */
export type RoleAssignmentQueryContext = {
  readonly database: Database
  readonly companyId: string
}

/** 變更後仍然有效的一個角色。 */
export type AssignedRole = {
  readonly assignmentId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly assignedAt: string
}

/**
 * 指派或撤銷完成後的完整結果。
 *
 * 刻意回**變更後的全部有效角色**，而不是只回這次動了哪幾筆：狀態變更端點要讓前端不必再打一次
 * 查詢端點（§1.2），而且「他現在到底有哪些角色」正是使用者當下唯一關心的問題。
 */
export type RoleAssignmentSnapshot = {
  readonly companyUserId: string
  readonly roles: readonly AssignedRole[]
}

/** 清單的一列。撤銷相關欄位在指派仍有效時為 `null`。 */
export type RoleAssignmentListItem = {
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

/**
 * 清單查詢條件。
 *
 * 選填條件用 `string | null` 而不是選填屬性：service 層的型別與 HTTP 的 request 型別**刻意分開**
 * （§1.8.0），這裡不需要區分「沒送這個欄位」與「送了 undefined」，只需要區分「篩不篩」。
 */
export type RoleAssignmentQuery = {
  readonly companyUserId: string | null
  readonly roleId: string | null
  readonly includeRevoked: boolean
  readonly perPage: number
  readonly currentPage: number
  readonly sort: AssignmentSort
}

export type RoleAssignmentPage = {
  readonly items: readonly RoleAssignmentListItem[]
  readonly totalCount: number
}

/** 角色指派／撤銷的輸入。`roleIds` 至少一筆，由 schema 保證（§2）。 */
export type RoleAssignmentInput = {
  readonly companyUserId: string
  readonly roleIds: readonly string[]
}
