/**
 * 業務動作：查詢整棵部門樹。
 *
 * **不分頁**（§1.4 的例外，理由見 `departments-main.routes.ts` 對這個決定的完整說明）：部門樹
 * 通常不大，分頁一棵樹沒有意義——第二頁的節點找不到自己的父節點。
 *
 * 沒有業務錯誤（§3.1.3）：公司內沒有任何部門時回空陣列，不是錯誤。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentsMainContext } from '../domain/department-context.ts'
import type { DepartmentTreeNode } from '../domain/department-model.ts'
import { buildDepartmentTree } from '../domain/department-tree.ts'
import { listDepartmentNodes } from '../departments-main.repository.ts'

export const getDepartmentTree = async (
  context: DepartmentsMainContext,
): Promise<ServiceResult<readonly DepartmentTreeNode[]>> =>
  succeed(buildDepartmentTree(await listDepartmentNodes(context.db, context.companyId)))
