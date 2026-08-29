/**
 * 資料存取：在交易內鎖定並確認一位員工存在。
 *
 * **`FOR UPDATE` 是 `employee_employments` 唯一的併發序列化手段，不是效能微調**（計畫 §4.3、
 * `db/schema/employee-employments.ts` 檔頭）。鎖的粒度＝**員工**：兩個請求同時替同一位員工建立
 * 任職時，第二個必須等第一個交易結束才能讀到「目前有效任職」的最新樣子，否則兩者都會在同一份
 * 舊快照上判斷「沒有重疊」而同時寫入。
 *
 * 理由與寫法比照 `company-users/roles/impl/company-users-roles.find-company-user.repository.ts`
 * ——鎖的是「擁有者」那一列（`employees`），不是正在寫入的表本身（`employee_employments`
 * 在「新增」的情境下，這筆要寫入的列還不存在，沒有東西可鎖）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employees } from '../../../../db/schema/index.ts'

/**
 * @param runner **必須是交易物件**，否則 `FOR UPDATE` 的鎖會在語句結束時就釋放，等於沒鎖。
 * @returns 查無此員工（不存在、屬於別家公司、或已軟刪除）時回 `null`，三者回同一種結果、
 *   走的是同一行程式碼（§3.2、§4.2）。
 */
export const findEmployeeForUpdate = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: employees.id },
      employees,
      eq(employees.id, employeeId),
      eq(employees.deletedSeq, 0),
      isNull(employees.deletedAt),
    )
    .limit(1)
    .for('update')

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
