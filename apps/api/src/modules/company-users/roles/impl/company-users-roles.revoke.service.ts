/**
 * 業務動作：撤銷公司成員的一或多個角色。
 *
 * 兩件事必須在同一交易內完成，而且順序不能反（§4.4）：
 * 1. **鎖住成員列**，再讀出目前有效的指派——「最後一個角色」的判定以撤銷後的計數為準，
 *    而那個計數只有在序列化之後才可信。不鎖的話，兩個人同時各撤掉一半，兩邊都會算出
 *    「撤完還剩一個」而同時放行，結果是成員一個角色都不剩，而 UI §3.5 明文禁止這件事。
 * 2. **條件式 UPDATE**，把「尚未撤銷」寫進 `WHERE` 並比對影響列數。
 *
 * **本檔不開交易**：`revokeRolesInTransaction` 只收外部交易 handle（`TransactionRunner`，
 * `db/client.ts`），開交易的包裝（含下面的 {@link RevocationConflict} 攔截）在入口檔
 * `company-users-roles.service.ts` 的 `revokeRoles`。
 *
 * 業務拒絕一律收集後回傳、不拋例外（§3.1.1）——`RevocationConflict` 是唯一的例外中的例外，
 * 見它自己的檔頭。
 *
 * **稽核與寫入同一交易**（稽核計畫 §5），且必須在判定「這次撤銷確實成立」之後才記——
 * 半套的撤銷不該留下一筆「撤銷成功」的稽核。`recordAudit` 收 `TransactionRunner`，
 * 傳裸連線池是編譯錯誤，不必再靠 `check-audit-transaction.ts` 讀語法樹判斷「有沒有交易」
 * （該腳本的職責變化見其檔頭）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import type { ServiceResult } from '../../../../shared/service-result.ts'
import { fail, succeed } from '../../../../shared/service-result.ts'
import { serializeRoleIds } from '../domain/role-assignment-audit.ts'
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
 * 交易回滾用的標記，**必須 export**：判定它的那一段邏輯留在這裡（收 handle 的那一支），
 * 但把它轉換成 `ServiceResult` 業務錯誤的 `try`／`catch` 現在在入口檔（交易邊界所在的那一層），
 * 兩處分屬不同檔案，因此不能再是模組內部私有的類別。
 *
 * **這個 `throw` 不是「以例外表達業務拒絕」**（§3.1.1 禁止的那件事）：業務錯誤仍然是被收集起來、
 * 以 `fail(...)` 回傳給呼叫端的。之所以必須拋，是因為 drizzle 只在回呼拋出例外時才會 ROLLBACK
 * ——影響列數不符代表已經有一部分列被改掉了，此時直接 `return fail(...)` 會把那半套變更 **commit**，
 * 使用者收到「狀態已變更，請重新載入」，資料庫裡卻真的少了幾個角色。
 *
 * **透過 `revokeRolesInTransaction` 被 Stage 4 編排點呼叫時**，這個例外沒有被攔下的對象
 * ——它會原樣往上拋，讓編排點自己的交易一起回滾（那本來就是編排點要的效果：這支動作的一部分
 * 出了問題，整筆業務都不該 commit）。編排點若想把它翻譯成一句業務訊息，需要自己 `catch`
 * 這個類別；本輪明確排除 Stage 4 的編排本身，因此這裡只做到「例外可以被外部識別」為止。
 */
export class RevocationConflict extends Error {
  constructor() {
    super('角色指派在本次交易之外已被變更，交易需回滾')
    this.name = 'RevocationConflict'
  }
}

export const revokeRolesInTransaction = async (
  transaction: TransactionRunner,
  context: RoleAssignmentContext,
  input: RoleAssignmentInput,
): Promise<ServiceResult<RoleAssignmentSnapshot>> => {
  const revokedAt = context.clock.now()
  // 非零的撤銷序號（§4.3）：唯一鍵 `(company_id, company_user_id, role_id, revoked_seq)`
  // 只有在「有效列一律為 0、撤銷列一律非 0」時才真的成立。同一批共用一個值不會撞鍵，
  // 因為同一次撤銷裡不會出現兩筆相同的 role_id。
  const revokedSeq = context.clock.epochMs()

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

  const affectedRows = await revokeAssignments(transaction, context.companyId, plan.assignmentIdsToRevoke, {
    revokedAt,
    revokedBy: context.operatorCompanyUserId,
    revokedSeq,
  })

  // 成員列已被鎖住，理論上不會走到這裡；仍然檢查，因為「理論上不會發生」與
  // 「發生了也沒人知道」之間的差別，就是這一個 if（§4.4 要求檢查影響列數）。
  if (affectedRows !== plan.assignmentIdsToRevoke.length) {
    throw new RevocationConflict()
  }

  const roles = await listActiveAssignments(transaction, context.companyId, input.companyUserId)

  await recordAudit(transaction, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'company-users.roles.revoke',
    subjectTable: 'company_users',
    subjectId: input.companyUserId,
    // 理由與 create 切片相同：before／after 是撤銷前後**完整**的有效角色集合，不是只記
    // 「撤了哪幾個」。
    changes: buildAuditChanges(
      'company_users',
      { roleIds: serializeRoleIds(activeAssignments.map((assignment) => assignment.roleId)) },
      { roleIds: serializeRoleIds(roles.map((role) => role.roleId)) },
    ),
    effectiveDate: null,
    now: revokedAt,
  })

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
}
