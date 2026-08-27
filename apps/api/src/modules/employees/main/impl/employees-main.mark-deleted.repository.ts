/**
 * 資料存取：軟刪除員工。
 *
 * **軟刪除而不是實體刪除**（§4.3）：員工是所有出勤、請假、薪資紀錄的資料主體，
 * 實體刪掉之後那些歷史紀錄會指向一個不存在的人，而它們本身不可被抹除。
 *
 * **加密欄位不清空。** 直覺上「既然刪了就把個資也清掉」聽起來更安全，但那會讓
 * 已刪除員工的舊薪資單、舊出勤紀錄再也對不出是誰，事後爭議與勞檢時無從舉證；
 * 個資的防線是加密本身（§5.1），不是刪除時順手清空。真正的保存期限清理應該是一個
 * 有排程、有稽核的獨立作業，不是刪除端點的副作用。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { employees } from '../../../../db/schema/index.ts'

export type EmployeeDeletion = {
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
  /**
   * 軟刪除後寫進 `deleted_seq` 的非零值（§4.3）。
   *
   * 由呼叫端傳入而不是在這裡算，是因為它必須來自注入的 clock——底層自己抓時間，
   * 這條路徑就再也測不到「同一個員工編號刪掉之後可以重新建立」這件事。
   */
  readonly deletedSeq: number
}

/**
 * 標記刪除。
 *
 * @returns 影響列數。**0 代表在讀取與寫入之間已經有人刪掉它了**（§4.4）——
 *   呼叫端必須把它轉成「狀態已變更」而不是當成成功，否則兩個使用者同時按刪除，
 *   第二個人會看到一個成功的回應與一位其實不是他刪掉的員工。
 */
export const markEmployeeDeleted = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
  deletion: EmployeeDeletion,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    employees,
    { deletedAt: deletion.now, deletedSeq: deletion.deletedSeq, updatedAt: deletion.now },
    eq(employees.id, employeeId),
    // 條件式 UPDATE 的「預期目前狀態」：這筆必須還沒被刪除（§4.4）。
    eq(employees.deletedSeq, 0),
    isNull(employees.deletedAt),
  )

  return readAffectedRows(result)
}
