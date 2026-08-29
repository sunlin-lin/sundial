/**
 * 資料存取：在交易內鎖定並確認一位員工存在。鎖的粒度＝員工，理由與 `withholding/main/impl/
 * withholding-main.find-employee-for-update.repository.ts` 同構。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employees } from '../../../../db/schema/index.ts'

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
