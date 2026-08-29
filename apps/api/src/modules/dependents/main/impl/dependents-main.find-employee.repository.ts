/**
 * 資料存取：確認一位員工存在（`create` 用）。
 *
 * **不帶 `FOR UPDATE`，與 `withholding`／`labor-pension` 的同名切片不同**——這裡沒有理由上鎖：
 * 本表沒有 §4.3 的「有效期間不得重疊」處置（見 `db/schema/employee-dependents.ts` 檔頭），
 * 唯一要防的重複（同一員工同一身分證）交給資料庫唯一鍵直接擋（insert 攔截違反），
 * 不是「先查一批既有紀錄、鎖住再比較」，因此不需要鎖來序列化併發請求。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employees } from '../../../../db/schema/index.ts'

export const findEmployeeForReference = async (
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

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
