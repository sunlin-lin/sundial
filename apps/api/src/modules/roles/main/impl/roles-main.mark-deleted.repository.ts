/**
 * 資料存取：軟刪除角色。
 *
 * `role_permissions` **不跟著刪**（`docs/ui/07-ui-role-permission.md`）：歷史操作紀錄仍須能顯示
 * 當時使用的角色與它當時的權限，查詢有效權限時改以「排除已刪除的角色」達成。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { roles } from '../../../../db/schema/index.ts'
import { readAffectedRows } from '../domain/driver-result.ts'

export type RoleDeletion = {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
  /**
   * 軟刪除後寫進 `deleted_seq` 的非零值（§4.3）。
   *
   * 由呼叫端傳入而不是在這裡算，是因為它必須來自注入的 clock——底層自己抓時間，
   * 這條路徑就再也測不到「同一個代碼刪掉之後可以重新建立」這件事。
   */
  readonly deletedSeq: number
}

/**
 * 標記刪除。
 *
 * @returns 影響列數。**0 代表在讀取與寫入之間已經有人刪掉它了**（§4.4）——
 *   呼叫端必須把它轉成「狀態已變更」而不是當成成功，否則兩個使用者同時按刪除，
 *   第二個人會看到一個成功的回應與一個其實不是他刪掉的角色。
 */
export const markRoleDeleted = async (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  deletion: RoleDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    roles,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(roles.id, roleId),
    // 條件式 UPDATE 的「預期目前狀態」：這筆必須還沒被刪除（§4.4）。
    eq(roles.deletedSeq, 0),
    isNull(roles.deletedAt),
  )

  return readAffectedRows(result)
}
