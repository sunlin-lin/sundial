/**
 * 業務動作：指派一或多個角色給公司成員。
 *
 * 交易邊界在這一層（§4.4）：讀成員、讀角色、讀現有指派、寫入、再讀回變更後的結果，
 * 全部必須是同一個原子操作。分開跑的話，兩個人同時操作會讓「這個角色還沒給過」的判斷
 * 建立在已經過期的快照上，而症狀是一個唯一鍵違反（HTTP 500），不是一句看得懂的話。
 *
 * 業務拒絕一律**收集後回傳**，不拋例外（§3.1.1）：使用者一次勾了五個角色，
 * 沒有理由讓他修一個、送一次、再被退回。
 */
import type { ServiceResult } from '../../../../shared/service-result.ts'
import { fail, succeed } from '../../../../shared/service-result.ts'
import { planRoleAssignment } from '../domain/role-assignment-plan.ts'
import {
  findCompanyUserForUpdate,
  findRolesByIds,
  insertAssignments,
  listActiveAssignments,
} from '../company-users-roles.repository.ts'
import type {
  RoleAssignmentContext,
  RoleAssignmentInput,
  RoleAssignmentSnapshot,
} from '../domain/role-assignment-model.ts'

export const assignRoles = (
  context: RoleAssignmentContext,
  input: RoleAssignmentInput,
): Promise<ServiceResult<RoleAssignmentSnapshot>> => {
  // 時間在交易外先取好，讓同一批指派的 `assigned_at` 完全相同——分別取的話，
  // 同一次操作寫出來的紀錄會相差幾毫秒，而「這幾筆是同一次指派的嗎」就再也答不出來。
  const assignedAt = context.clock.now()

  return context.database.transaction(async (transaction) => {
    // 先鎖住成員列，本次目錄所有角色異動都走這道鎖（見 find-company-user repository）。
    const member = await findCompanyUserForUpdate(transaction, context.companyId, input.companyUserId)
    const rolesById = await findRolesByIds(transaction, context.companyId, input.roleIds)
    const activeAssignments = await listActiveAssignments(transaction, context.companyId, input.companyUserId)

    // 所有「准不准」的判斷都在這一個純函式裡（見 domain/role-assignment-plan.ts）。
    // 成員不存在時上面兩支查詢等於白跑，這是刻意的取捨：把判斷留在單一位置，
    // 比省下兩次查詢重要——分散之後，「什麼情況回哪個錯」就會散在三個 if 裡。
    const plan = planRoleAssignment({
      member,
      requestedRoleIds: input.roleIds,
      rolesById,
      activeAssignments,
    })

    if (plan.errors.length > 0) {
      // 這裡直接 return 而不是拋例外：此時一列都還沒寫，交易 commit 一個空的異動即可。
      // 業務拒絕不是意外，不該走例外路徑（§3.1.2）。
      return fail(plan.errors)
    }

    await insertAssignments(
      transaction,
      context.companyId,
      plan.roleIdsToAssign.map((roleId) => ({
        // UUID 在應用層產生：主鍵是 char(36)，資料庫端沒有序列可用，而先寫再讀回 id
        // 會多一次往返，且批次寫入時根本讀不回來是哪幾筆。
        id: crypto.randomUUID(),
        companyUserId: input.companyUserId,
        roleId,
        assignedAt,
        assignedBy: context.operatorCompanyUserId,
      })),
    )

    // 回變更後的全部有效角色，而不是把剛剛寫進去的那幾筆湊出來：湊出來的版本會漏掉
    // 「他本來就有的角色」，而使用者要看的是最終狀態。在同一交易內讀，看到的一定是這次寫入後的樣子。
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
}
