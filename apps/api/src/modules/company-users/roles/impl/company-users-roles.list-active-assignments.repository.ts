/**
 * 資料存取動作：讀取一位成員目前仍有效的角色指派。
 *
 * 這一個動作同時服務三個地方（§0.4：repository 的動作 ＝ 資料存取動作，不是端點動作）：
 * 指派前的重複檢查、撤銷前的「最後一個角色」計數，以及兩支端點回傳的「變更後全部有效角色」。
 * 複製成三份的話，哪天「有效」的定義改了（例如要不要含停用角色），一定會有一處沒改到，
 * 而且不會有任何地方變紅。
 */
import { asc, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUserRoles, roles } from '../../../../db/schema/index.ts'

export type ActiveAssignmentRow = {
  readonly assignmentId: string
  readonly roleId: string
  readonly roleCode: string
  readonly roleName: string
  readonly assignedAt: string
}

/**
 * 「有效」的定義：**未撤銷**（`revoked_seq = 0`）**且角色未被軟刪除**。
 *
 * 第二個條件容易被漏掉，但少了它會出現一種很難查的狀況：角色被刪除後，指向它的指派仍算數，
 * 於是成員的「有效角色數」把一個什麼權限都給不出來的角色算進去——而
 * `listPermissionCodes`（授權判定的唯一依據）是排除已刪除角色的。兩邊對不起來的結果是
 * 「系統說他有角色，但他什麼都打不開」，而且「最後一個角色」的保護也跟著失效。
 *
 * join `roles` 時同時比對 `company_id`（§4.2）：`role_permissions` 有複合外鍵保證同公司，
 * 但 `company_user_roles → roles` 的外鍵只指向 `roles.id`，同公司這件事在這裡只能靠查詢條件擋。
 */
export const listActiveAssignments = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<readonly ActiveAssignmentRow[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .selectFrom(
      {
        assignmentId: companyUserRoles.id,
        roleId: companyUserRoles.roleId,
        roleCode: roles.code,
        roleName: roles.name,
        assignedAt: companyUserRoles.assignedAt,
      },
      companyUserRoles,
    )
    .innerJoin(roles, eq(roles.id, companyUserRoles.roleId))
    // 兩張表的公司條件都由 `scopeAll()` 產生（§4.2 要求 JOIN 的每一張帶 `company_id` 的表都要帶）。
    // `company_user_roles → roles` 的外鍵只指向 `roles.id`，同公司這件事在資料庫層沒有任何保證，
    // 只能靠查詢條件擋——所以它必須來自封裝，不能是手寫的一行。
    .where(
      tenant.scopeAll(
        [companyUserRoles, roles],
        eq(companyUserRoles.companyUserId, companyUserId),
        eq(companyUserRoles.revokedSeq, 0),
        isNull(roles.deletedAt),
      ),
    )
    .orderBy(asc(roles.code))

  return rows.map((row) => ({
    assignmentId: row.assignmentId,
    roleId: row.roleId,
    roleCode: row.roleCode,
    roleName: row.roleName,
    assignedAt: row.assignedAt,
  }))
}
