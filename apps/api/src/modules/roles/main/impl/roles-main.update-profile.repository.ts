/**
 * 資料存取：更新角色的基本資料（名稱與說明）。
 *
 * **這裡刻意不檢查影響列數。** §4.4 的「條件式 UPDATE ＋ 檢查影響列數」針對的是**狀態變更**，
 * 而 MySQL 預設回傳的 `affectedRows` 是**實際變更的列數**：使用者按了儲存卻沒改任何欄位時，
 * 這個數字是 0——拿它當併發衝突的依據，會讓一個完全正常的操作被回報成「資料已被別人改過」。
 * 角色的狀態變更走 `activate`／`deactivate`，那兩支才用得到影響列數（見 update-status 切片）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { roles } from '../../../../db/schema/index.ts'

export type RoleProfileUpdate = {
  readonly name: string
  readonly description: string | null
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const updateRoleProfile = async (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  profile: RoleProfileUpdate,
): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  await tenant.update(
    roles,
    { name: profile.name, description: profile.description, updatedAt: profile.now },
    eq(roles.id, roleId),
    // 未刪除才寫得進去：呼叫端讀到角色與這次寫入之間若有人把它刪了，這個條件會讓寫入落空，
    // 而不是把資料寫回一筆已刪除的角色上（§4.3）。兩個欄位都寫是刻意的——`deleted_seq` 是
    // 唯一鍵的參與者（併發時真正擋得住的那一個），`deleted_at` 則是這張表的軟刪除語意本身。
    eq(roles.deletedSeq, 0),
    isNull(roles.deletedAt),
  )
}
