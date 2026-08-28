/**
 * 資料存取：這個部門底下有沒有（未刪除的）子部門。
 *
 * `delete` 前的檢查用（資料字典「定案：樹的四條規則」第 3 條）：只回布林，不撈子部門的內容
 * ——刪除前只需要知道「有沒有」，不需要知道是哪幾筆，`LIMIT 1` 讓這支查詢在子部門很多時
 * 也不必整批掃完。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments } from '../../../../db/schema/index.ts'

export const hasChildDepartments = async (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
): Promise<boolean> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .select(
      { id: departments.id },
      departments,
      eq(departments.parentId, departmentId),
      eq(departments.deletedSeq, 0),
      isNull(departments.deletedAt),
    )
    .limit(1)

  return rows.length > 0
}
