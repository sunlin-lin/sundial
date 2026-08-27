/**
 * 資料存取動作：在交易內鎖定並讀取一位公司成員。
 *
 * **`FOR UPDATE` 是這個次目錄唯一的併發序列化手段，不是效能微調。** 指派與撤銷都先鎖住
 * `company_users` 的那一列，於是「同一位成員的角色異動」在資料庫層被排成一條線：
 * - 撤銷：兩個人同時各撤掉一半角色，若不序列化，兩邊都會算出「撤完還剩一個」而同時放行，
 *   結果是成員一個角色都不剩——而 UI §3.5 明文要求至少保留一個。
 * - 指派：兩個人同時指派同一個角色，若不序列化，兩邊的預先檢查都會說「還沒有」，
 *   接著第二筆 INSERT 撞上唯一鍵，使用者拿到的是 500 而不是「已經有這個角色了」。
 *
 * 鎖的是成員列而不是指派列，因為指派列在「新增」的情境下還不存在，沒有東西可鎖。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUsers } from '../../../../db/schema/index.ts'
import type { CompanyUserState } from '../domain/role-assignment-plan.ts'

/**
 * @param runner **必須是交易物件**，否則 `FOR UPDATE` 的鎖會在語句結束時就釋放，等於沒鎖。
 * @returns 查無此成員時回 `null`。**「屬於別家公司」走的是同一條路**：`company_id` 寫在 `WHERE`
 *   裡（§4.2），別家公司的成員在查詢階段就等同於不存在，因此上層想回出不一致的訊息都寫不出來（§3.2）。
 */
export const findCompanyUserForUpdate = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<CompanyUserState | null> => {
  // 公司條件由 §4.2 的封裝補上，不是手寫的一行：這一支的回傳值決定「這個人存不存在」，
  // 而漏掉公司條件的症狀是「以 B 公司的身分鎖住並讀到 A 公司的成員」——查詢有回資料，
  // 不會有任何錯誤，後面的指派會照常成功。
  const rows = await new TenantDatabase(runner, companyId)
    .select({ id: companyUsers.id, status: companyUsers.status }, companyUsers, eq(companyUsers.id, companyUserId))
    .limit(1)
    .for('update')

  const row = rows[0]
  return row === undefined ? null : { id: row.id, status: row.status }
}
