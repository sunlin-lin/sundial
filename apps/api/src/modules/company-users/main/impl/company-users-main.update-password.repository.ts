/**
 * 資料存取：更新登入帳號的密碼雜湊（管理者重設密碼，UI 定案 `docs/ui/20-employee-list.md` §3.5）。
 *
 * **本表沒有 `company_id`**（`users` 是全域表，見 `db/schema/users.ts` 檔頭），因此不透過
 * `TenantDatabase`——直接以 `QueryRunner` 依 `users.id` 更新是正確的，不是繞過封裝：呼叫端
 * （`impl/company-users-main.reset-password.service.ts`）必須先用 `findCompanyUserById` 在
 * 公司範圍內確認過這個 `userId` 屬於本公司的成員，這裡才收得到它。
 *
 * **固定把 `mustChangePassword` 寫成 `true`**：管理者重設的密碼跟建立帳號時的初始密碼一樣，
 * 都是別人替使用者選的，不是使用者自己選的，下一次登入理應強制變更（UI §2.4「員工第一次登入
 * 必須強制變更密碼」的同一個道理，見 `company-users-main.create.service.ts` 的 `insertUser` 呼叫）。
 */
import { eq } from 'drizzle-orm'
import type { QueryRunner } from '../../../../db/client.ts'
import { users } from '../../../../db/schema/index.ts'

export type PasswordUpdate = {
  /** 已經是雜湊值，**不是明文**（§5.1）——呼叫端必須先用 `sessions` 的 `hashPassword` 算過。 */
  readonly passwordHash: string
  /** 台北牆鐘時間，由呼叫端注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const updateUserPassword = async (
  runner: QueryRunner,
  userId: string,
  update: PasswordUpdate,
): Promise<void> => {
  await runner
    .update(users)
    .set({
      passwordHash: update.passwordHash,
      mustChangePassword: true,
      passwordChangedAt: update.now,
      updatedAt: update.now,
    })
    .where(eq(users.id, userId))
}
