/**
 * 業務動作：啟用角色。
 *
 * 狀態變更走自己的端點而不是在 `update` 的 body 帶 `status`（§1.2）：狀態欄位可寫等於客戶端
 * 可以直接把資料改成任一目標狀態，跳過該轉移應有的前置檢查（停用那一支就有「最後一個管理角色」
 * 的檢查）。狀態動作端點回傳**變更後的完整角色**，讓前端不必再打一次查詢端點。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { RoleDetail, RoleTargetInput } from '../domain/role-model.ts'
import { roleNotFound, roleStateChanged } from '../roles-main.errors.ts'
import { findRoleDetail, updateRoleStatus } from '../roles-main.repository.ts'

export const activateRole = async (
  context: RolesMainContext,
  input: RoleTargetInput,
): Promise<ServiceResult<RoleDetail>> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<RoleDetail>> => {
    const current = await findRoleDetail(tx, context.companyId, input.id)
    // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
    if (current === null) return fail([roleNotFound()])

    // 條件式 UPDATE：`WHERE status = 'INACTIVE'`。影響 0 列代表它已經是啟用狀態
    // ——有人搶先做了同一件事，或使用者手上的清單是舊的（§4.4）。
    const affectedRows = await updateRoleStatus(tx, context.companyId, input.id, 'activate', now)
    if (affectedRows === 0) return fail([roleStateChanged()])

    const updated = await findRoleDetail(tx, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛更新成功的角色讀不回來。
      throw new Error(`角色 ${input.id} 啟用後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
