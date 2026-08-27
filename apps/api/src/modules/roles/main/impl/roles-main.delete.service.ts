/**
 * 業務動作：刪除角色（軟刪除）。
 *
 * 刪除前的三道檢查來自 `docs/ui/07-ui-role-permission.md`：是否仍被公司成員使用、
 * 是否為最後一個具管理能力的角色、是否為系統預設角色。三道**一起檢查、一起回報**（§3.1.1）
 * ——只回第一筆的話，使用者移轉完成員之後再送一次，才發現它還是最後一個管理角色。
 */
import { fail, succeed, type DomainError, type ServiceResult } from '../../../../shared/service-result.ts'
import { isLastAdminCapableRole } from '../domain/admin-capability.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { DeletedRole, RoleTargetInput } from '../domain/role-model.ts'
import { lastAdminRole, roleInUse, roleNotFound, roleStateChanged, systemRoleProtected } from '../roles-main.errors.ts'
import { findRoleDetail, listAdminCapableRoles, markRoleDeleted } from '../roles-main.repository.ts'

export const deleteRole = async (
  context: RolesMainContext,
  input: RoleTargetInput,
): Promise<ServiceResult<DeletedRole>> => {
  const now = context.clock.now()
  // 軟刪除時同時寫入非零的 `deleted_seq`（§4.3）：UNIQUE 索引中 NULL 互不相等，
  // 只寫 `deleted_at` 的話「未刪除資料的代碼唯一」等於沒擋。用刪除當下的 epoch 毫秒，
  // 同一筆角色只會被刪除一次，因此不可能與自己碰撞。
  const deletedSeq = context.clock.epochMs()

  return context.db.transaction(async (tx): Promise<ServiceResult<DeletedRole>> => {
    const current = await findRoleDetail(tx, context.companyId, input.id)
    // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
    if (current === null) return fail([roleNotFound()])

    const errors: DomainError[] = []

    if (current.isSystem) errors.push(systemRoleProtected())

    // 已被指派的角色不能直接刪除，必須先把成員移轉到其他角色——直接刪掉會讓那些成員瞬間
    // 失去權限，而畫面上沒有任何地方看得出原因。
    if (current.assignedUserCount > 0) errors.push(roleInUse(current.assignedUserCount))

    const adminRoles = await listAdminCapableRoles(tx, context.companyId)
    if (isLastAdminCapableRole(input.id, adminRoles)) errors.push(lastAdminRole())

    if (errors.length > 0) return fail(errors)

    // 條件式 UPDATE ＋ 檢查影響列數（§4.4）：兩個使用者同時按刪除時，第二筆影響 0 列。
    // 少了這道檢查，第二個人會拿到一個成功的回應，而他其實什麼也沒做。
    const affectedRows = await markRoleDeleted(tx, context.companyId, input.id, { now, deletedSeq })
    if (affectedRows === 0) return fail([roleStateChanged()])

    return succeed({ id: input.id })
  })
}
