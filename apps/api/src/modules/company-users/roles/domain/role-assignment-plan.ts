/**
 * 角色指派與撤銷的業務規則（零 IO 純函式，§0.4 的 `domain/`）。
 *
 * 這裡是**唯一**決定「這批操作准不准」的地方，service 只負責把資料撈進來、把結果寫回去。
 * 這樣切的理由不是分層潔癖：規則放在這裡才測得動——「一次違反兩條規則要回兩筆錯誤」
 * （§7.1）這種案例，在需要資料庫的整合測試裡佈置成本高到實務上不會有人寫，
 * 而它偏偏是唯一能證明 service 真的在收集錯誤、而不是在第一筆就中斷的方式（§3.1.1）。
 *
 * 本檔**只收集錯誤、不拋例外**（§3.1.1）：業務拒絕是設計時就知道會發生的結果，不是意外。
 */
import {
  CompanyUserStatus,
  RoleStatus,
  type CompanyUserStatusValue,
  type RoleStatusValue,
} from '../../../../db/schema/index.ts'
import type { DomainError } from '../../../../shared/service-result.ts'
import {
  assignmentNotFound,
  companyUserInactive,
  companyUserNotFound,
  lastRoleRequired,
  roleAlreadyAssigned,
  roleInactive,
  roleNotFound,
} from '../company-users-roles.errors.ts'

/** 公司成員的現況；`null` 代表查無此成員——**或這位成員屬於別家公司**（§3.2，兩者不可區分）。 */
export type CompanyUserState = {
  readonly id: string
  readonly status: CompanyUserStatusValue
}

/** 角色的現況。已軟刪除的角色不會出現在這裡（repository 已濾掉），因此等同於「不存在」。 */
export type RoleState = {
  readonly id: string
  readonly status: RoleStatusValue
}

/** 一筆仍然有效（未撤銷）的角色指派。 */
export type ActiveAssignment = {
  readonly assignmentId: string
  readonly roleId: string
}

export type AssignmentPlan = {
  readonly errors: readonly DomainError[]
  /** 通過全部檢查、應該寫入的角色 id，已去重並保留輸入順序。 */
  readonly roleIdsToAssign: readonly string[]
}

export type RevocationPlan = {
  readonly errors: readonly DomainError[]
  /** 通過全部檢查、應該標記撤銷的指派 id。 */
  readonly assignmentIdsToRevoke: readonly string[]
}

/**
 * 規劃一次角色指派。
 *
 * 成員層級的問題（不存在、已停用）**直接整批拒絕、不再逐筆檢查角色**：這兩種情況下
 * 使用者要做的事只有一件（換一個成員／先啟用帳號），把後面五筆角色錯誤一起吐出去
 * 只是噪音，而且會讓真正的原因被埋在清單中間。
 *
 * 角色層級則相反：**每一筆都檢查完才回傳**，錯幾筆就回幾筆（§3.1.1）。使用者一次勾了五個角色，
 * 沒有理由讓他修一個、送一次、再被退回。
 */
export const planRoleAssignment = (input: {
  readonly member: CompanyUserState | null
  readonly requestedRoleIds: readonly string[]
  readonly rolesById: ReadonlyMap<string, RoleState>
  readonly activeAssignments: readonly ActiveAssignment[]
}): AssignmentPlan => {
  if (input.member === null) return { errors: [companyUserNotFound()], roleIdsToAssign: [] }
  if (input.member.status !== CompanyUserStatus.Active) {
    return { errors: [companyUserInactive()], roleIdsToAssign: [] }
  }

  const assignedRoleIds = new Set(input.activeAssignments.map((assignment) => assignment.roleId))
  const errors: DomainError[] = []
  const planned = new Set<string>()
  const roleIdsToAssign: string[] = []

  input.requestedRoleIds.forEach((roleId, index) => {
    const role = input.rolesById.get(roleId)
    if (role === undefined) {
      errors.push(roleNotFound(index))
      return
    }
    if (role.status !== RoleStatus.Active) {
      errors.push(roleInactive(index))
      return
    }
    // `planned` 這一半處理的是「同一個角色在請求中出現兩次」。schema 已用 `uniqueItems` 擋掉
    // （見 routes），這裡是第二道：漏掉的話兩筆相同的 INSERT 會撞上
    // `uq_company_user_roles_assignment` 唯一鍵，使用者拿到的是 500 而不是一句看得懂的話。
    if (assignedRoleIds.has(roleId) || planned.has(roleId)) {
      errors.push(roleAlreadyAssigned(index))
      return
    }
    planned.add(roleId)
    roleIdsToAssign.push(roleId)
  })

  return { errors, roleIdsToAssign }
}

/**
 * 規劃一次角色撤銷。
 *
 * **刻意不檢查成員是否停用**（與指派不同）：離職會同步停用帳號（UI §3.2），
 * 而「員工離職了，把他的角色收回來」正是最需要能做的操作之一。擋掉它等於讓停用的帳號
 * 永遠保留著它離職當下的權限，一旦帳號被重新啟用就整組回來。
 *
 * 「最後一個角色」的判定以**撤銷後的計數**為準，且與逐筆錯誤一起收集：
 * 呼叫端必須在同一個交易內拿到這個結果才有意義（見 service）。
 */
export const planRoleRevocation = (input: {
  readonly member: CompanyUserState | null
  readonly requestedRoleIds: readonly string[]
  readonly activeAssignments: readonly ActiveAssignment[]
}): RevocationPlan => {
  if (input.member === null) return { errors: [companyUserNotFound()], assignmentIdsToRevoke: [] }

  const assignmentByRoleId = new Map(
    input.activeAssignments.map((assignment): [string, ActiveAssignment] => [assignment.roleId, assignment]),
  )
  const errors: DomainError[] = []
  const planned = new Map<string, string>()

  input.requestedRoleIds.forEach((roleId, index) => {
    const assignment = assignmentByRoleId.get(roleId)
    // 重複出現的第二筆同樣回「找不到可撤銷的指派」：它確實已經沒有第二筆有效指派可以撤銷了。
    if (assignment === undefined || planned.has(roleId)) {
      errors.push(assignmentNotFound(index))
      return
    }
    planned.set(roleId, assignment.assignmentId)
  })

  // `planned.size > 0` 這個前提不能省：成員本來就沒有任何有效角色時（理論上不該發生），
  // 使用者收到的應該只有「找不到可撤銷的指派」，再附加一筆「不能撤銷最後一個角色」
  // 只會讓人以為系統自相矛盾。
  if (planned.size > 0 && input.activeAssignments.length - planned.size <= 0) {
    errors.push(lastRoleRequired())
  }

  return { errors, assignmentIdsToRevoke: [...planned.values()] }
}
