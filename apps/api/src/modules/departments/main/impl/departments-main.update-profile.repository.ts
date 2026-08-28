/**
 * 資料存取：更新部門主檔的基本欄位（含改上層部門與狀態）。
 *
 * **這裡刻意不檢查影響列數**（與 `shifts-main.update-profile.repository.ts`／
 * `roles-main.update-profile.repository.ts` 同一個理由，處置逐字相同）：§4.4 的「條件式 UPDATE
 * ＋ 檢查影響列數」是為了偵測**狀態變更**的併發衝突，而 MySQL 預設回傳的 `affectedRows` 是
 * **實際變更的列數**——部門的欄位都是明文，使用者按了儲存卻沒改任何欄位時這個數字會是 0，
 * 拿它當併發衝突的依據會把一個完全正常的操作誤報成「資料已被別人改過」。部門的軟刪除走
 * `markDepartmentDeleted`，那一支才用得到影響列數（刪除是保證會變更的狀態轉移）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments, type DepartmentStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateDepartmentCode } from '../domain/department-duplicate.ts'

export type DepartmentProfileUpdate = {
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: DepartmentStatusValue
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export type DepartmentProfileUpdateOutcome = 'written' | 'duplicate-code'

export const updateDepartmentProfile = async (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
  update: DepartmentProfileUpdate,
): Promise<DepartmentProfileUpdateOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.update(
      departments,
      {
        parentId: update.parentId,
        code: update.code,
        name: update.name,
        description: update.description,
        status: update.status,
        updatedAt: update.now,
      },
      eq(departments.id, departmentId),
      // 未刪除才寫得進去：呼叫端讀到部門與這次寫入之間若有人把它刪了，這個條件會讓寫入落空，
      // 而不是把資料寫回一筆已刪除的部門上（§4.3）。
      eq(departments.deletedSeq, 0),
      isNull(departments.deletedAt),
    )

    return 'written'
  } catch (error) {
    if (isDuplicateDepartmentCode(error)) return 'duplicate-code'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，含複合外鍵違反（見 insert 切片同段說明）。
    throw error
  }
}
