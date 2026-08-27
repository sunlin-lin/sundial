/**
 * 資料存取：本公司目前具「管理能力」的角色（未刪除者）。
 *
 * 「哪些權限碼算管理能力」是業務判斷，放在 `domain/admin-capability.ts`；本檔只負責把那組碼
 * 翻成一次查詢。這是 §0.4 說的「repository 的動作是資料存取動作，不是端點動作」——
 * `delete` 與 `deactivate` 兩支端點各自呼叫它，不需要複製，也不需要切片之間互相依賴。
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { permissions, rolePermissions, roles } from '../../../../db/schema/index.ts'
import { ADMIN_CAPABILITY_PERMISSION_CODES, type AdminCapableRole } from '../domain/admin-capability.ts'

/**
 * 顯式 `select` ＋ `join`（§4.6），不用 relational query API。
 *
 * 三張表都帶條件：`roles` 的公司範圍由 `scope()` 補上，`role_permissions` 的公司條件寫在 join 上
 * （§4.2 要求 JOIN 的每一張帶 `company_id` 的表都要帶條件——少了它，別家公司的授權列會被 join 進來，
 * 而查詢**有回資料**，不會有任何錯誤），`permissions` 是全域表因此只過濾軟刪除與權限碼。
 */
export const listAdminCapableRoles = async (
  runner: QueryRunner,
  companyId: string,
): Promise<readonly AdminCapableRole[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  return tenant
    .selectFrom({ id: roles.id, status: roles.status }, roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(
      permissions,
      and(
        eq(permissions.id, rolePermissions.permissionId),
        isNull(permissions.deletedAt),
        inArray(permissions.code, [...ADMIN_CAPABILITY_PERMISSION_CODES]),
      ),
    )
    // 兩張帶公司範圍的表都由 `scopeAll()` 補條件（`permissions` 是全域表，不進來）。
    // `role_permissions` 的公司條件原本手寫在 `ON` 裡，用的是傳進來的 `companyId` 參數；
    // 改由封裝產生之後，兩張表必定比對到同一個、而且是唯一一個公司 ID。
    // 條件從 `ON` 移到 `WHERE` 對 INNER JOIN 而言等價（外連結才會有差）。
    .where(tenant.scopeAll([roles, rolePermissions], isNull(roles.deletedAt)))
    // 一個角色可能同時擁有多個管理權限碼，join 之後會出現重複列；用 groupBy 收斂成一列一角色。
    // 沒有它，「只有一個管理角色」會被算成三個，最後一道防線就此失效。
    .groupBy(roles.id, roles.status)
}
