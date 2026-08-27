/**
 * 資料存取動作：依 id 批次取出本公司的角色現況。
 *
 * 一次撈完再組 Map，不在迴圈裡逐筆查（§4.5）：一次指派十個角色就是十次往返，
 * 看起來只是慢，實際上會在尖峰時段耗盡連線池，讓其他端點一起失敗。
 */
import { inArray, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { roles } from '../../../../db/schema/index.ts'
import type { RoleState } from '../domain/role-assignment-plan.ts'

/**
 * @returns 以角色 id 為鍵的對照表。**已軟刪除的角色不會出現在結果裡**（§4.3），
 *   於是它在上層等同於「不存在」——這正是想要的：已刪除的角色不得再授予新使用者（UI §刪除角色）。
 *   停用（`status = INACTIVE`）的角色**仍會回傳**，讓上層能回一個講得清楚的「角色已停用」，
 *   而不是把它含糊成「找不到角色」。
 *
 * 別家公司的角色同樣不會出現：`company_id` 寫在 `WHERE` 裡（§4.2），
 * 因此「別家的」與「不存在」在回應上逐項相同（§3.2）。
 */
export const findRolesByIds = async (
  runner: QueryRunner,
  companyId: string,
  roleIds: readonly string[],
): Promise<ReadonlyMap<string, RoleState>> => {
  // `IN ()` 不是合法 SQL，而「沒有要查的東西」本來就不需要往資料庫走一趟。
  if (roleIds.length === 0) return new Map()

  // 公司條件由 §4.2 的封裝補上，不是手寫的一行：本查詢決定「這些角色存不存在」，
  // 漏掉它就等於允許把別家公司的角色指派給本公司成員，而權限會跟著跨公司流過來。
  const rows = await new TenantDatabase(runner, companyId).select(
    { id: roles.id, status: roles.status },
    roles,
    inArray(roles.id, [...new Set(roleIds)]),
    isNull(roles.deletedAt),
  )

  return new Map(rows.map((row): [string, RoleState] => [row.id, { id: row.id, status: row.status }]))
}
