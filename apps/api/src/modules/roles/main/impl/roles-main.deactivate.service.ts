/**
 * 業務動作：停用角色。
 *
 * 與啟用不對稱的地方只有一處：停用要擋「公司最後一個還能用的管理角色」。
 * 停用後不可再授予（`docs/ui/07-ui-role-permission.md`），若那是最後一個能調整權限的角色，
 * 公司就再也沒有人能把它啟用回來。
 */
import { fail, succeed, type DomainError, type ServiceResult } from '../../../../shared/service-result.ts'
import { wouldDeactivateLastAdminCapableRole } from '../domain/admin-capability.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { RoleDetail, RoleTargetInput } from '../domain/role-model.ts'
import { lastAdminRole, roleNotFound, roleStateChanged } from '../roles-main.errors.ts'
import { findRoleDetail, listAdminCapableRoles, updateRoleStatus } from '../roles-main.repository.ts'

export const deactivateRole = async (
  context: RolesMainContext,
  input: RoleTargetInput,
): Promise<ServiceResult<RoleDetail>> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<RoleDetail>> => {
    const current = await findRoleDetail(tx, context.companyId, input.id)
    // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
    if (current === null) return fail([roleNotFound()])

    const errors: DomainError[] = []

    const adminRoles = await listAdminCapableRoles(tx, context.companyId)
    if (wouldDeactivateLastAdminCapableRole(input.id, adminRoles)) errors.push(lastAdminRole())

    if (errors.length > 0) return fail(errors)

    // 條件式 UPDATE：`WHERE status = 'ACTIVE'`。影響 0 列代表它已經是停用狀態（§4.4）。
    const affectedRows = await updateRoleStatus(tx, context.companyId, input.id, 'deactivate', now)
    if (affectedRows === 0) return fail([roleStateChanged()])

    const updated = await findRoleDetail(tx, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛更新成功的角色讀不回來。
      throw new Error(`角色 ${input.id} 停用後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
