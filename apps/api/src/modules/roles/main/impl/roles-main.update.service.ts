/**
 * 業務動作：修改角色（名稱、說明與權限）。
 *
 * 權限的更新方式是**整組換掉**：刪掉該角色原有的 `role_permissions` 再寫入新的，
 * 與角色本身的欄位在同一交易內完成（§4.4）。
 */
import { checkAssignable } from '../../../permissions/index.ts'
import { fail, succeed, type DomainError, type ServiceResult } from '../../../../shared/service-result.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { RoleDetail, UpdateRoleInput } from '../domain/role-model.ts'
import { collectPermissionSelectionErrors, dedupePermissionIds } from '../domain/role-permission-rules.ts'
import { roleNotFound, systemRoleProtected } from '../roles-main.errors.ts'
import { findRoleDetail, replaceRolePermissions, updateRoleProfile } from '../roles-main.repository.ts'

export const updateRole = async (
  context: RolesMainContext,
  input: UpdateRoleInput,
): Promise<ServiceResult<RoleDetail>> => {
  // 跨大目錄走對方的 service（§0.3），且排在交易之前（唯讀查詢，不必佔著列鎖）。
  const permissionErrors = collectPermissionSelectionErrors(
    input.permissionIds,
    await checkAssignable(context.db, input.permissionIds),
  )

  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<RoleDetail>> => {
    const current = await findRoleDetail(tx, context.companyId, input.id)
    // 動作類端點的「目標不存在」是業務錯誤（§3.1.3）：使用者確實嘗試了一個做不到的操作。
    // 回 200 等於告訴前端「改好了」，畫面會若無其事地更新成完成後的狀態。
    // **別家公司的角色也走這一行**，回一模一樣的錯誤（§3.2）。
    // 權限錯誤一併帶上：一次把所有問題回給使用者，而不是讓他修一次、送一次、再被退回一次。
    if (current === null) return fail([roleNotFound(), ...permissionErrors])

    const errors: DomainError[] = []

    // 系統預設角色的內容由系統定義：公司改過之後，日後系統要調整這個角色的權限時，
    // 分不出哪些是原本的、哪些是客戶改的，也就無從升級。因此整支拒絕，而不是只擋權限。
    // （`is_system` 不上畫面，UI 不顯示預設／自訂分類，這個碼是使用者唯一會知道原因的管道。）
    if (current.isSystem) errors.push(systemRoleProtected())
    errors.push(...permissionErrors)

    if (errors.length > 0) return fail(errors)

    await updateRoleProfile(tx, context.companyId, input.id, {
      name: input.name,
      description: input.description,
      now,
    })
    await replaceRolePermissions(tx, context.companyId, input.id, dedupePermissionIds(input.permissionIds), now)

    const updated = await findRoleDetail(tx, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛讀到、剛寫過的角色又讀不回來了。
      throw new Error(`角色 ${input.id} 更新後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
