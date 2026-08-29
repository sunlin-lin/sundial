/**
 * 資料存取：在交易內鎖定並確認一筆任職存在。
 *
 * **鎖的粒度＝任職，不是員工**（計畫 §4.3 的例外，`db/schema/employee-department-histories.ts`
 * 檔頭）：部門歷史記的是「這個任職期間他在哪個部門」，同一個員工的兩筆不同任職（例如離職又回任）
 * 各自有自己獨立的部門歸屬時間軸，鎖同一位員工反而會讓兩筆互不相干的任職互相排隊等待。
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
