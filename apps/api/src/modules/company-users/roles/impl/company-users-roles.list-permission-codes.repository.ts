/**
 * 資料存取動作：查出一位公司成員目前實際擁有的權限碼。
 *
 * **這是全站授權判定的唯一依據**（`shared/access-control.ts` 的 `PermissionLookup`），
 * 身分驗證 middleware 每個請求呼叫一次。因此這支查詢的每一個條件都直接對應一條安全規則，
 * 少一個就是一個越權：
 *
 * | 條件 | 少了它會怎樣 |
 * |---|---|
 * | `cur.company_id = ?` | 使用者在 A 公司的角色會在 B 公司生效 |
 * | `r.company_id = ?` | 指派可以指向別家公司的角色，權限跟著跨公司流過來 |
 * | `rp.company_id = ?` | 同上，授權列可以掛在別家公司的角色上 |
 * | `cur.revoked_seq = 0` | 撤銷的角色還在生效，「移除角色」等於沒做 |
 * | `r.deleted_seq = 0` | 已刪除的角色仍然發權限 |
 * | `r.status = 'ACTIVE'` | 停用的角色仍然發權限，「停用」等於沒做 |
 * | `p.deleted_seq = 0` / `p.status = 'ACTIVE'` | 已下架的權限碼還能通過授權 |
 * | `p.is_assignable = 1` | 分類節點（大／次目錄）被當成端點權限，等於一次授出一整片功能 |
 *
 * 前三條的三個 `?` 是**同一個值**，而且不是參數傳進來的：它們由 `TenantDatabase.scopeAll()`
 * 從封裝內部的公司 ID 產生（§4.2）。三張表各自比對一個「可能被填錯的字串」與三張表
 * 一起比對「唯一一個、外面拿不到的值」，在正確的時候等價，出錯的時候差很多。
 *
 * `permissions` 是全域表（沒有 `company_id`），因此只有它這一段不帶公司條件——這是刻意的，
 * 見 `db/schema/permissions.ts`：權限碼由端點路徑機械推導（§5.2.2），不是公司自訂的東西。
 *
 * 顯式 `select` ＋ `join`，不使用 relational query API（§4.6）：這段 SQL 每個請求都會跑，
 * 它的 `EXPLAIN` 必須看得懂。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import {
  companyUserRoles,
  permissions,
  PermissionStatus,
  rolePermissions,
  roles,
  RoleStatus,
} from '../../../../db/schema/index.ts'

/**
 * @returns 權限碼集合（`<大目錄>.<次目錄>.<動作>`）。查無資料回空集合，不是錯誤。
 *
 * 軟刪除用 `deleted_seq = 0` 而不是 `deleted_at IS NULL`（兩者等價，見 §4.3 的
 * `deleted_seq NOT NULL DEFAULT 0` 設計）：這是每個請求都會跑的熱路徑，
 * 條件落在 NOT NULL 且已進唯一鍵的欄位上，比對 NULL 便宜也更容易被索引使用。
 *
 * **不做任何跨請求快取。** 角色撤銷與角色停用必須即時生效——快取一分鐘，就等於
 * 「已經把權限收回來的人還能再操作一分鐘」，而那一分鐘正是收回權限最要緊的時候
 * （員工離職、帳號疑似被盜）。這條規則沒有例外，要加快取必須連同失效機制一起設計。
 */
export const listPermissionCodes = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<ReadonlySet<string>> => {
  const tenant = new TenantDatabase(runner, companyId)

  // 三張帶公司範圍的表（`company_user_roles`／`roles`／`role_permissions`）的公司條件一律由
  // `scopeAll()` 產生。原本它們是手寫的：`cur.company_id = <參數>`，其餘兩張則是
  // 「等於前一張的 company_id」。兩種寫法在正確的時候等價，但手寫版本有兩個弱點——
  // 少寫一張不會有任何地方變紅，而公司 ID 是一個從外面傳進來、可以被填成別的值的字串。
  // 交給封裝之後，三張表都從同一個私有欄位取值，「其中一張漏了」與「其中一張比對到別家公司」
  // 都變成寫不出來。這一支是**全站授權判定的唯一依據**，是最不能靠記憶力守的一支。
  const rows = await tenant
    .selectDistinctFrom({ code: permissions.code }, companyUserRoles)
    .innerJoin(roles, eq(roles.id, companyUserRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    // `permissions` 是全域表（沒有 `company_id`），因此不進 `scopeAll()`——見檔頭說明。
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      tenant.scopeAll(
        [companyUserRoles, roles, rolePermissions],
        eq(companyUserRoles.companyUserId, companyUserId),
        eq(companyUserRoles.revokedSeq, 0),
        eq(roles.deletedSeq, 0),
        eq(roles.status, RoleStatus.Active),
        eq(permissions.deletedSeq, 0),
        eq(permissions.status, PermissionStatus.Active),
        eq(permissions.isAssignable, true),
      ),
    )

  return new Set(rows.map((row) => row.code))
}
