/**
 * 資料存取：在交易內鎖定並確認一筆任職存在。**鎖的粒度＝任職**，與 `department-histories` 的同名
 * 切片完全同構（字典：「同一任職同一時間只能有一筆有效職稱」，與部門同一種粒度）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments } from '../../../../db/schema/index.ts'

export const findEmploymentForUpdate = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: employeeEmployments.id },
      employeeEmployments,
      eq(employeeEmployments.id, employmentId),
      eq(employeeEmployments.deletedSeq, 0),
      isNull(employeeEmployments.deletedAt),
    )
    .limit(1)
    .for('update')

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
