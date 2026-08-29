/**
 * 資料存取：新增登入帳號（`users`，全域表，實作計畫 `05-employee-onboarding.md` Stage 4）。
 *
 * **本表沒有 `company_id`**（`db/schema/users.ts` 檔頭：「全域登入帳號與驗證資料；不得併入
 * `employees`」），因此不透過 `TenantDatabase`——那個封裝只接受 `CompanyScopedTable`，`users`
 * 不在其中，硬套會編譯失敗。直接以 `QueryRunner` 寫入是正確的，不是繞過封裝：封裝要擋的是
 * 「帶公司範圍的表漏了公司條件」，這裡沒有公司範圍可漏。
 *
 * **唯一性由資料庫的 `uq_users_username` 唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：
 * 兩個不同公司的建立者同時替各自的新員工選了同一個帳號，必須有且只有一個成功——
 * 先查再寫在併發下必然漏判。撞鍵時**不做任何補救查詢或更新**，直接回一個分類結果交給呼叫端：
 * 定案是拒絕，不是連結既有帳號（理由見 `domain/company-user-duplicate.ts` 檔頭）。
 */
import type { QueryRunner } from '../../../../db/client.ts'
import { users } from '../../../../db/schema/index.ts'
import { isUsernameDuplicate } from '../domain/company-user-duplicate.ts'

export type UserInsertOutcome = 'inserted' | 'duplicate-username'

export type NewUser = {
  readonly id: string
  readonly username: string
  /** 已經是雜湊值，**不是明文**（§5.1）——呼叫端必須先用 `sessions` 的 `hashPassword` 算過。 */
  readonly passwordHash: string
  readonly mustChangePassword: boolean
  /** 台北牆鐘時間，由呼叫端注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertUser = async (runner: QueryRunner, user: NewUser): Promise<UserInsertOutcome> => {
  try {
    await runner.insert(users).values({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      mustChangePassword: user.mustChangePassword,
      passwordChangedAt: null,
      createdAt: user.now,
      updatedAt: user.now,
    })
    return 'inserted'
  } catch (error) {
    if (isUsernameDuplicate(error)) return 'duplicate-username'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因。
    // **刻意不把 `error` 包進帶著明文的新訊息裡**——密碼雜湊與帳號不得進 log（§5.1）。
    throw error
  }
}
