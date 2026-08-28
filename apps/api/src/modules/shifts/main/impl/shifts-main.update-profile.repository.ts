/**
 * 資料存取：更新班別主檔的基本欄位與推導值。
 *
 * **這裡刻意不檢查影響列數**（與 `roles-main.update-profile.repository.ts` 同一個理由，處置
 * 逐字相同）：§4.4 的「條件式 UPDATE ＋ 檢查影響列數」是為了偵測**狀態變更**的併發衝突，而
 * MySQL 預設回傳的 `affectedRows` 是**實際變更的列數**——班別的欄位都是明文（不像 `employees`
 * 的加密欄位每次寫入 IV 都不同、`affectedRows` 恆 ≥ 1），使用者按了儲存卻沒改任何欄位時這個
 * 數字會是 0，拿它當併發衝突的依據會把一個完全正常的操作誤報成「資料已被別人改過」。
 * 班別的軟刪除走 `markShiftDeleted`，那一支才用得到影響列數（刪除是保證會變更的狀態轉移）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { shiftDefinitions, type ShiftWorkTypeValue } from '../../../../db/schema/index.ts'
import { isDuplicateShiftCode } from '../domain/shift-duplicate.ts'

export type ShiftProfileUpdate = {
  readonly code: string
  readonly name: string
  readonly workTypeCode: ShiftWorkTypeValue
  readonly isOvernight: boolean
  readonly isFlexible: boolean
  readonly requiredWorkMinutes: number
  readonly description: string
  readonly isActive: boolean
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export type ShiftProfileUpdateOutcome = 'written' | 'duplicate-code'

export const updateShiftProfile = async (
  runner: QueryRunner,
  companyId: string,
  shiftId: string,
  update: ShiftProfileUpdate,
): Promise<ShiftProfileUpdateOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.update(
      shiftDefinitions,
      {
        code: update.code,
        name: update.name,
        workTypeCode: update.workTypeCode,
        isOvernight: update.isOvernight,
        isFlexible: update.isFlexible,
        requiredWorkMinutes: update.requiredWorkMinutes,
        description: update.description,
        isActive: update.isActive,
        updatedAt: update.now,
      },
      eq(shiftDefinitions.id, shiftId),
      // 未刪除才寫得進去：呼叫端讀到班別與這次寫入之間若有人把它刪了，這個條件會讓寫入落空，
      // 而不是把資料寫回一筆已刪除的班別上（§4.3）。兩個欄位都寫是刻意的——`deletedSeq` 是
      // 唯一鍵的參與者，`deletedAt` 則是這張表軟刪除語意的本體。
      eq(shiftDefinitions.deletedSeq, 0),
      isNull(shiftDefinitions.deletedAt),
    )

    return 'written'
  } catch (error) {
    if (isDuplicateShiftCode(error)) return 'duplicate-code'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋。
    throw error
  }
}
