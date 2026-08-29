/**
 * 資料存取：依 id 查一位公司成員，取回所屬的登入帳號 id。
 *
 * 唯一呼叫者是重設密碼（`impl/company-users-main.reset-password.service.ts`）：先在公司範圍內
 * 確認目標成員存在，再取得對應的 `users.id` 才能去更新密碼。**不用 `FOR UPDATE`**——重設密碼
 * 沒有「必須序列化」的不變量（不像角色撤銷要保護「最後一個角色」的計數，見 `company-users/roles`
 * 的 `findCompanyUserForUpdate`）：兩個請求同時重設密碼，結果就是最後寫入的那次生效，
 * 不會有資料損毀或計數錯誤的風險。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUsers } from '../../../../db/schema/index.ts'

/**
 * @returns 查無此成員時回 `null`——**「屬於別家公司」走的是同一條路**（§3.2、§4.2）：`company_id`
 *   由 `TenantDatabase` 補上，別家公司的成員在查詢階段就等同於不存在。
 */
export const findCompanyUserById = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<{ readonly id: string; readonly userId: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select({ id: companyUsers.id, userId: companyUsers.userId }, companyUsers, eq(companyUsers.id, companyUserId))
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id, userId: row.userId }
}
