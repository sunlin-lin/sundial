/**
 * 資料存取：角色的啟用／停用（狀態變更）。
 *
 * §4.4 的核心形態就在這裡：把**預期的目前狀態**寫進 `WHERE`，再檢查影響列數。
 * 先讀再寫的話，兩個使用者同時操作會讓狀態變更的副作用被套用兩次，而回應都是成功。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { roles, RoleStatus } from '../../../../db/schema/index.ts'
import { readAffectedRows } from '../domain/driver-result.ts'

/**
 * 狀態轉移的意圖。
 *
 * service 傳的是「要做哪一件事」而不是「目標狀態是什麼」：預期的來源狀態與目標狀態必須成對，
 * 拆成兩個參數就會出現「來源填 ACTIVE、目標也填 ACTIVE」這種永遠影響 0 列、卻沒有任何地方
 * 看得出錯在哪的組合。對照表放在本檔，是因為它是資料層的事實，不是業務判斷。
 */
export type RoleStatusIntent = 'activate' | 'deactivate'

const TRANSITIONS = {
  activate: { from: RoleStatus.Inactive, to: RoleStatus.Active },
  deactivate: { from: RoleStatus.Active, to: RoleStatus.Inactive },
} as const

/**
 * 變更狀態。
 *
 * @returns 影響列數。0 代表**前置狀態不成立**——角色已經是目標狀態（有人搶先做了同一件事），
 *   或已被刪除。呼叫端一律轉成「狀態已變更，請重新載入」，不是靜靜地當成成功。
 */
export const updateRoleStatus = async (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  intent: RoleStatusIntent,
  now: string,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)
  const transition = TRANSITIONS[intent]

  const result = await tenant.update(
    roles,
    { status: transition.to, updatedAt: now },
    eq(roles.id, roleId),
    eq(roles.status, transition.from),
    eq(roles.deletedSeq, 0),
    isNull(roles.deletedAt),
  )

  return readAffectedRows(result)
}
