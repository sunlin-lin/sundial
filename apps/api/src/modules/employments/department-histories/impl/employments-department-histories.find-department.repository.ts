/**
 * 資料存取：確認一個部門存在（供 `create` 驗證 `departmentId`）。
 *
 * 直接查 `departments` 表，不透過 `departments` 模組的 service——理由與 `company-users/roles`
 * 直接查 `roles` 表同構（`impl/company-users-roles.find-roles.repository.ts`）：這是單純的
 * 存在性 ＋ 公司範圍檢查，不涉及 `departments` 模組自己的業務規則（樹狀結構、成環、軟刪除以外
 * 沒有其他狀態要考慮）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments } from '../../../../db/schema/index.ts'

export const findDepartmentForReference = async (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
): Promise<{ readonly id: string } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select(
      { id: departments.id },
      departments,
      eq(departments.id, departmentId),
      eq(departments.deletedSeq, 0),
      isNull(departments.deletedAt),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
