/**
 * `permissions/main` 的業務入口（§0.4）。
 *
 * 兩個動作，其中 `checkAssignable` **沒有對應的端點**——它的呼叫者是 `roles/main`
 * 的建立與更新流程。沒有端點的業務動作一樣放入口，因為它同樣是這個次實體對外的介面，
 * 只是呼叫者不是前端（§0.4）。
 *
 * 兩支都收 `QueryRunner`（連線池或交易物件皆可）而不是連線本身：
 * `checkAssignable` 會在角色建立／更新的**交易內**被呼叫，它必須與那次寫入看到同一份快照。
 */
import type { PermissionNode } from './domain/permission-tree.ts'
import {
  checkAssignable as checkAssignableImpl,
  type AssignabilityCheck,
} from './impl/permissions-main.check-assignable.service.ts'
import { loadPermissionTree as loadPermissionTreeImpl } from './impl/permissions-main.tree.service.ts'
import type { QueryRunner } from './permissions-main.repository.ts'

export type { AssignabilityCheck }
export type { PermissionNode }
export type { QueryRunner }

/** 取得整棵權限樹（已排除軟刪除與停用節點），查無資料回空陣列。 */
export const loadPermissionTree = (runner: QueryRunner): Promise<readonly PermissionNode[]> =>
  loadPermissionTreeImpl(runner)

/**
 * 檢查一組權限 id 是否存在且可授權，供角色建立／更新驗證使用者勾選的權限。
 * 回傳「不存在」與「存在但不可授權」兩份清單，錯誤怎麼組由呼叫端決定。
 */
export const checkAssignable = (runner: QueryRunner, permissionIds: readonly string[]): Promise<AssignabilityCheck> =>
  checkAssignableImpl(runner, permissionIds)
