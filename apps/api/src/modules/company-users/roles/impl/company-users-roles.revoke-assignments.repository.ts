/**
 * 資料存取動作：批次標記撤銷角色指派。
 *
 * **撤銷寫的是 `revoked_at`／`revoked_by`／`revoked_seq`，不是 `deleted_at`，更不是 DELETE。**
 * 這張表是稽核事實（§4.3、§5.3）：誰在什麼時候把哪個角色給了誰、又是誰收回來的，
 * 爭議發生時全靠這幾欄舉證。實體刪除之後，事後沒有任何方法補救。
 *
 * `revoked_seq` 必須是**非零值**：MariaDB 的 UNIQUE 索引中 `NULL` 互不相等，
 * 唯一鍵 `(company_id, company_user_id, role_id, revoked_seq)` 只有在「有效列一律為 0」
 * 時才真的擋得住重複指派（見 `db/schema/company-user-roles.ts`）。
 */
import { eq, inArray } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUserRoles } from '../../../../db/schema/index.ts'

export type Revocation = {
  /** 撤銷時刻，台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly revokedAt: string
  /** 撤銷者的公司成員 id，來自已驗證的身分。 */
  readonly revokedBy: string
  /** 非零的撤銷序號；同一批撤銷共用一個值（不同列的 role_id 不同，唯一鍵不會撞）。 */
  readonly revokedSeq: number
}

/**
 * 條件式 UPDATE（§4.4）：把「預期的目前狀態」（`revoked_seq = 0`，也就是尚未撤銷）寫進 `WHERE`，
 * 由呼叫端比對影響列數。先讀再寫的話，兩個使用者同時操作會讓撤銷的副作用被套用兩次
 * ——而這裡的副作用包含「最後一個角色」的計數，套兩次就是把人的角色清空。
 *
 * 這一支用 `TenantDatabase`（§4.2 的封裝）而不是自己組 `WHERE`：它會把
 * `company_id = <本公司>` 放進條件的第一段，於是「改到別家公司的資料」在型別與查詢兩層都寫不出來。
 *
 * @returns 實際被撤銷的列數。小於預期即代表在本次交易之外已有人動過同一批指派。
 */
export const revokeAssignments = async (
  runner: QueryRunner,
  companyId: string,
  assignmentIds: readonly string[],
  revocation: Revocation,
): Promise<number> => {
  if (assignmentIds.length === 0) return 0

  const result = await new TenantDatabase(runner, companyId).update(
    companyUserRoles,
    {
      revokedAt: revocation.revokedAt,
      revokedBy: revocation.revokedBy,
      revokedSeq: revocation.revokedSeq,
      updatedAt: revocation.revokedAt,
    },
    inArray(companyUserRoles.id, [...assignmentIds]),
    eq(companyUserRoles.revokedSeq, 0),
  )

  return result[0].affectedRows
}
