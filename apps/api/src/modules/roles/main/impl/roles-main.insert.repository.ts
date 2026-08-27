/**
 * 資料存取：新增角色。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：兩個併發請求會同時查到
 * 「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現，測試環境重現不了。
 * 這裡直接寫入並攔截唯一鍵違反，轉成一個業務結果交給 service 判斷。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { isUniqueViolation } from '../../../../db/driver-error.ts'
import { roles, RoleStatus } from '../../../../db/schema/index.ts'

/** `roles` 的公司內代碼唯一鍵（migration 與 schema 逐字相同的名稱）。 */
const ROLE_CODE_UNIQUE_INDEX = 'uq_roles_company_code'

export type RoleInsertOutcome = 'inserted' | 'duplicate-code'

export type NewRole = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

/**
 * 這個例外是不是「角色代碼重複」。
 *
 * 比對到**索引名稱**而不是只看錯誤碼：`roles` 上還有 `uq_roles_company_id`，撞到它代表
 * 產生的 UUID 與既有列相同——那是不該發生的事，必須以系統錯誤爆出來讓人知道，而不是
 * 對使用者說「代碼重複」然後讓他換一個代碼再試一次（他怎麼換都不會成功）。
 */
const isDuplicateRoleCode = (error: unknown): boolean =>
  isUniqueViolation(error, ROLE_CODE_UNIQUE_INDEX)

/**
 * 寫入一筆角色。
 *
 * 新角色一律 `is_system = false`、`status = ACTIVE`：`is_system` 是系統預設角色的保護旗標，
 * 由 seed 建立，不開放客戶端設定；狀態不收在 request body 裡（§1.2 禁止以 body 的 `status`
 * 完成狀態變更），要停用請走 `deactivate` 端點。
 */
export const insertRole = async (runner: QueryRunner, companyId: string, role: NewRole): Promise<RoleInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(roles, (scopedCompanyId) => ({
      id: role.id,
      companyId: scopedCompanyId,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: false,
      status: RoleStatus.Active,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: role.now,
      updatedAt: role.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateRoleCode(error)) return 'duplicate-code'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因，交給統一 error handler 記錄。
    throw error
  }
}
