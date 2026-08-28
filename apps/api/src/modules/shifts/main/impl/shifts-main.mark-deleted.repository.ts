/**
 * 資料存取：軟刪除班別。
 *
 * **軟刪除而不是實體刪除**（§4.3）：即使本輪沒有任何表引用 `shift_definitions`（計畫 §7、
 * 本檔錯誤字典檔頭已詳述），排班模組上線後歷史班表會引用到當時的班別，實體刪除會讓那些引用
 * 指向一個不存在的東西。
 *
 * **這裡「有」檢查影響列數**，與 `updateShiftProfile` 刻意相反：刪除是保證會變更的狀態轉移
 * （`deletedSeq` 從 `0` 變成非零、`deletedAt` 從 `NULL` 變成有值，這兩個欄位在「還沒刪除」與
 * 「已經刪除」兩種狀態下必然不同），不像一般欄位更新可能「送進來的值跟資料庫裡的一樣」。
 * 因此「0 列」在這裡只有一種含義：在讀取與寫入之間，別人已經把它刪掉了（§4.4）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { shiftDefinitions } from '../../../../db/schema/index.ts'

export type ShiftDeletion = {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
  /**
   * 軟刪除後寫進 `deleted_seq` 的非零值（§4.3）。由呼叫端傳入而不是在這裡算，理由與
   * `employees` 的同名欄位相同：必須來自注入的 clock，否則「刪除後同一個代碼可以重新建立」
   * 這件事就測不到。
   */
  readonly deletedSeq: number
}

/**
 * 標記刪除。
 *
 * @returns 影響列數。**0 代表在讀取與寫入之間已經有人刪掉它了**（§4.4）——呼叫端必須把它
 *   轉成「狀態已變更」而不是當成成功，否則兩個使用者同時按刪除，第二個人會看到一個成功的回應
 *   與一個其實不是他刪掉的班別。
 */
export const markShiftDeleted = async (
  runner: QueryRunner,
  companyId: string,
  shiftId: string,
  deletion: ShiftDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    shiftDefinitions,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(shiftDefinitions.id, shiftId),
    // 條件式 UPDATE 的「預期目前狀態」：這筆必須還沒被刪除（§4.4）。
    eq(shiftDefinitions.deletedSeq, 0),
    isNull(shiftDefinitions.deletedAt),
  )

  return readAffectedRows(result)
}
