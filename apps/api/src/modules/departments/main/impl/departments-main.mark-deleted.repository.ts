/**
 * 資料存取：軟刪除部門。
 *
 * **這裡「有」檢查影響列數**，與 `updateDepartmentProfile` 刻意相反：刪除是保證會變更的狀態
 * 轉移（`deletedSeq` 從 `0` 變成非零、`deletedAt` 從 `NULL` 變成有值，這兩個欄位在「還沒刪除」與
 * 「已經刪除」兩種狀態下必然不同），不像一般欄位更新可能「送進來的值跟資料庫裡的一樣」。
 * 因此「0 列」在這裡只有一種含義：在讀取與寫入之間，別人已經把它刪掉了（§4.4）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { departments } from '../../../../db/schema/index.ts'

export type DepartmentDeletion = {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
  /**
   * 軟刪除後寫進 `deleted_seq` 的非零值（§4.3）。由呼叫端傳入而不是在這裡算，理由與
   * `shifts`／`roles` 的同名欄位相同：必須來自注入的 clock，否則「刪除後同一個代碼可以重新
   * 建立」這件事就測不到。
   */
  readonly deletedSeq: number
}

/**
 * 標記刪除。
 *
 * @returns 影響列數。**0 代表在讀取與寫入之間已經有人刪掉它了**（§4.4）——呼叫端必須把它
 *   轉成「狀態已變更」而不是當成成功，否則兩個使用者同時按刪除，第二個人會看到一個成功的回應
 *   與一個其實不是他刪掉的部門。
 */
export const markDepartmentDeleted = async (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
  deletion: DepartmentDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    departments,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(departments.id, departmentId),
    // 條件式 UPDATE 的「預期目前狀態」：這筆必須還沒被刪除（§4.4）。
    eq(departments.deletedSeq, 0),
    isNull(departments.deletedAt),
  )

  return readAffectedRows(result)
}
