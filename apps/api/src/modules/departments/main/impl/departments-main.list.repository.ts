/**
 * 資料存取：該公司**全部**未刪除部門的扁平列表。
 *
 * **不分頁、不篩選、不排序**——這支查詢的兩個呼叫者都要「全部」：`tree` 端點要組裝整棵樹
 * （§1.4 的分頁在這裡沒有意義：分頁一棵樹之後，第二頁的節點找不到自己在第一頁的父節點，
 * 樹狀結構會斷成好幾截，見 `departments-main.routes.ts` 對這個決定的完整說明），
 * `update` 的成環檢查（`domain/department-tree.ts` 的 `wouldCreateCycle`）要沿著父節點鏈往上走，
 * 漏了鏈上任何一段都可能把真正的環誤判成安全。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments } from '../../../../db/schema/index.ts'
import type { DepartmentNode } from '../domain/department-model.ts'

export const listDepartmentNodes = async (
  runner: QueryRunner,
  companyId: string,
): Promise<readonly DepartmentNode[]> => {
  const tenant = new TenantDatabase(runner, companyId)

  return await tenant.select(
    {
      id: departments.id,
      parentId: departments.parentId,
      code: departments.code,
      name: departments.name,
      description: departments.description,
      status: departments.status,
    },
    departments,
    eq(departments.deletedSeq, 0),
    isNull(departments.deletedAt),
  )
}
