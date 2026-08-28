/**
 * 資料存取：新增班別主檔（不含子表，子表見 `shifts-main.replace-children.repository.ts`）。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：兩個併發請求會同時查到
 * 「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現，測試環境重現不了。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { shiftDefinitions, type ShiftWorkTypeValue } from '../../../../db/schema/index.ts'
import { isDuplicateShiftCode, type ShiftInsertOutcome } from '../domain/shift-duplicate.ts'

export type NewShift = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly workTypeCode: ShiftWorkTypeValue
  /** 推導值（計畫 §4.1），由 `domain/shift-validation.ts` 算出，這裡只負責寫入。 */
  readonly isOvernight: boolean
  readonly isFlexible: boolean
  /** 推導值（計畫 §4.1），同上。 */
  readonly requiredWorkMinutes: number
  readonly description: string
  readonly isActive: boolean
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertShift = async (
  runner: QueryRunner,
  companyId: string,
  shift: NewShift,
): Promise<ShiftInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(shiftDefinitions, (scopedCompanyId) => ({
      id: shift.id,
      companyId: scopedCompanyId,
      code: shift.code,
      name: shift.name,
      workTypeCode: shift.workTypeCode,
      isOvernight: shift.isOvernight,
      isFlexible: shift.isFlexible,
      requiredWorkMinutes: shift.requiredWorkMinutes,
      description: shift.description,
      isActive: shift.isActive,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: shift.now,
      updatedAt: shift.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateShiftCode(error)) return 'duplicate-code'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因，交給統一 error handler 記錄。
    throw error
  }
}
