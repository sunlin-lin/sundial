/**
 * 業務動作：新增角色。
 *
 * 角色與它的權限**必須在同一交易內完成**（§4.4、`docs/ui/07-ui-role-permission.md`）：
 * 只成功一半會留下一個「建好了但一個權限也沒有」的角色——它永遠用不了，而且沒有人會發現，
 * 因為它在清單上與正常角色長得一模一樣。
 */
import { checkAssignable } from '../../../permissions/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { CreateRoleInput, RoleDetail } from '../domain/role-model.ts'
import { collectPermissionSelectionErrors, dedupePermissionIds } from '../domain/role-permission-rules.ts'
import { roleCodeDuplicated } from '../roles-main.errors.ts'
import { findRoleDetail, insertRole, replaceRolePermissions } from '../roles-main.repository.ts'

export const createRole = async (
  context: RolesMainContext,
  input: CreateRoleInput,
): Promise<ServiceResult<RoleDetail>> => {
  // 權限的存在與可授權判定屬於 `permissions/main`，跨大目錄一律走對方的 service（§0.3）：
  // 直接讀它的表等於把它的規則（軟刪除、停用、分類節點）整組繞掉，而對方之後改了規則，
  // 這裡不會知道，也不會有任何地方變紅。
  //
  // 檢查排在交易**之前**：它是一次唯讀查詢，放進交易只會讓列鎖多持有一段時間（§3.4）。
  // 檢查與寫入之間權限被刪掉的競態，由 `role_permissions` 的外鍵擋住。
  const permissionErrors = collectPermissionSelectionErrors(
    input.permissionIds,
    await checkAssignable(context.db, input.permissionIds),
  )
  if (permissionErrors.length > 0) return fail(permissionErrors)

  const now = context.clock.now()
  const roleId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<RoleDetail>> => {
    // 代碼唯一性交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）：
    // 兩個併發請求會同時查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
    const outcome = await insertRole(tx, context.companyId, {
      id: roleId,
      code: input.code,
      name: input.name,
      description: input.description,
      now,
    })

    // 重複代碼時**立刻結束、不再對這個交易下任何一句寫入**（§3.4）：InnoDB 對唯一鍵違反只回滾
    // 那一句，交易本身仍然可用，但繼續寫下去就會出現「角色沒建起來、權限卻寫進去了」的孤兒列。
    // 這裡沒有任何後續寫入，交易帶著零筆變更結束。
    if (outcome === 'duplicate-code') return fail([roleCodeDuplicated()])

    await replaceRolePermissions(tx, context.companyId, roleId, dedupePermissionIds(input.permissionIds), now)

    const detail = await findRoleDetail(tx, context.companyId, roleId)
    if (detail === null) {
      // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的角色讀不回來，代表資料庫或本模組的
      // 公司範圍有問題，不是使用者做錯了什麼。走例外路徑才會帶著堆疊進告警。
      throw new Error(`角色 ${roleId} 建立後於同一交易內讀不回來`)
    }
    return succeed(detail)
  })
}
