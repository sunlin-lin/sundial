/**
 * 業務動作：撤銷公司成員的一或多個角色。
 *
 * 兩件事必須在同一交易內完成，而且順序不能反（§4.4）：
 * 1. **鎖住成員列**，再讀出目前有效的指派——「最後一個角色」的判定以撤銷後的計數為準，
 *    而那個計數只有在序列化之後才可信。不鎖的話，兩個人同時各撤掉一半，兩邊都會算出
 *    「撤完還剩一個」而同時放行，結果是成員一個角色都不剩，而 UI §3.5 明文禁止這件事。
 * 2. **條件式 UPDATE**，把「尚未撤銷」寫進 `WHERE` 並比對影響列數。
 *
 * 業務拒絕一律收集後回傳、不拋例外（§3.1.1）。
 */
import type { ServiceResult } from '../../../../shared/service-result.ts'
import { fail, succeed } from '../../../../shared/service-result.ts'
import { assignmentStateChanged } from '../company-users-roles.errors.ts'
import { planRoleRevocation } from '../domain/role-assignment-plan.ts'
import {
  findCompanyUserForUpdate,
  listActiveAssignments,
  revokeAssignments,
} from '../company-users-roles.repository.ts'
import type {
  RoleAssignmentContext,
  RoleAssignmentInput,
  RoleAssignmentSnapshot,
} from '../domain/role-assignment-model.ts'

/**
 * 交易回滾用的私有標記。
 *
 * **這個 `throw` 不是「以例外表達業務拒絕」**（§3.1.1 禁止的那件事）：業務錯誤仍然是被收集起來、
 * 以 `fail(...)` 回傳給呼叫端的。之所以必須拋，是因為 drizzle 只在回呼拋出例外時才會 ROLLBACK
 * ——影響列數不符代表已經有一部分列被改掉了，此時直接 `return fail(...)` 會把那半套變更 **commit**，
 * 使用者收到「狀態已變更，請重新載入」，資料庫裡卻真的少了幾個角色。
 *
 * 標記在本檔內被立刻攔下，不會流到任何其他地方。
 */
class RevocationConflict extends Error {
  constructor() {
    super('角色指派在本次交易之外已被變更，交易需回滾')
    this.name = 'RevocationConflict'
  }
}

export const revokeRoles = async (
  context: RoleAssignmentContext,
  input: RoleAssignmentInput,
): Promise<ServiceResult<RoleAssignmentSnapshot>> => {
  const revokedAt = context.clock.now()
  // 非零的撤銷序號（§4.3）：唯一鍵 `(company_id, company_user_id, role_id, revoked_seq)`
  // 只有在「有效列一律為 0、撤銷列一律非 0」時才真的成立。同一批共用一個值不會撞鍵，
  // 因為同一次撤銷裡不會出現兩筆相同的 role_id。
  const revokedSeq = context.clock.epochMs()

  try {
    return await context.database.transaction(async (transaction) => {
      const member = await findCompanyUserForUpdate(transaction, context.companyId, input.companyUserId)
      const activeAssignments = await listActiveAssignments(transaction, context.companyId, input.companyUserId)

      const plan = planRoleRevocation({
        member,
        requestedRoleIds: input.roleIds,
        activeAssignments,
      })

      if (plan.errors.length > 0) {
        // 一列都還沒動，直接回失敗即可（此時 commit 的是一個空的異動）。
        return fail(plan.errors)
      }

      const affectedRows = await revokeAssignments(
        transaction,
        context.companyId,
        plan.assignmentIdsToRevoke,
        { revokedAt, revokedBy: context.operatorCompanyUserId, revokedSeq },
      )

      // 成員列已被鎖住，理論上不會走到這裡；仍然檢查，因為「理論上不會發生」與
      // 「發生了也沒人知道」之間的差別，就是這一個 if（§4.4 要求檢查影響列數）。
      if (affectedRows !== plan.assignmentIdsToRevoke.length) {
        throw new RevocationConflict()
      }

      const roles = await listActiveAssignments(transaction, context.companyId, input.companyUserId)

      return succeed({
        companyUserId: input.companyUserId,
        roles: roles.map((role) => ({
          assignmentId: role.assignmentId,
          roleId: role.roleId,
          roleCode: role.roleCode,
          roleName: role.roleName,
          assignedAt: role.assignedAt,
        })),
      })
    })
  } catch (error) {
    if (error instanceof RevocationConflict) {
      // 交易已回滾，這裡把它轉回收集式的業務錯誤，讓邊界層依分組映射成 409／`300`。
      return fail([assignmentStateChanged()])
    }
    // 其餘一律是真正的意外（連不上資料庫、程式錯誤），原樣往上拋給統一 error handler，
    // 保留堆疊與告警（§3.1.2、§3.3「重拋時必須保留成因」）。
    throw error
  }
}
