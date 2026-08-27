/**
 * 「公司最後一個具管理能力的角色」的判定（零 IO 純函式）。
 *
 * 這條規則存在的理由是**公司可以把自己鎖在門外**：最後一個能調整權限的角色一旦被刪除或停用，
 * 就再也沒有人能把權限加回來——不是「比較麻煩」，是完全沒有路徑，只能靠人工進資料庫救，
 * 而那條路沒有稽核也沒有防呆。
 */
import { toPermissionCode } from '../../../../shared/path-code.ts'
import type { RoleStatusValue } from './role-model.ts'

/**
 * 具備「管理能力」的端點路徑。
 *
 * **寫路徑而不是直接寫權限碼**，是因為 §5.2.2 禁止手寫權限碼：手寫的碼在路徑改名時不會跟著改，
 * 也不會有任何地方變紅，於是這條保護規則會靜靜地對不上任何角色——最後一個管理角色就刪得掉了。
 * 由 {@link toPermissionCode} 推導，人腦與掃描腳本永遠得到同一個值。
 *
 * 為什麼是這三支：能改角色權限的人，等於能把任何權限授予任何人，那才是實質上的最高權限。
 * 只看「查詢角色」不夠（看得到不代表改得動），涵蓋到啟用／停用也沒有意義（那三支才是根源）。
 */
const ADMIN_CAPABILITY_PATHS = ['/roles/main/create', '/roles/main/update', '/roles/main/delete'] as const

/**
 * 具管理能力的權限碼集合。
 *
 * `filter` 掉 `null` 只是型別收窄：上面的路徑都是三段 kebab-case 字面值，
 * {@link toPermissionCode} 對它們一定推導得出來。真的推導不出來時集合會變小，
 * 而那代表有人改壞了上面的常數——測試會在「最後一個管理角色可以被刪掉」時失敗。
 */
export const ADMIN_CAPABILITY_PERMISSION_CODES: readonly string[] = ADMIN_CAPABILITY_PATHS.map(toPermissionCode).filter(
  (code): code is string => code !== null,
)

/** 具管理能力且未被刪除的角色。狀態一併帶出來，因為停用與刪除的判定條件不同（見下）。 */
export type AdminCapableRole = {
  readonly id: string
  readonly status: RoleStatusValue
}

/**
 * 刪除這個角色會不會讓公司再也沒有具管理能力的角色。
 *
 * 判定包含**已停用**的管理角色：停用是可逆的（還有人能把它啟用回來），刪除不可逆。
 * 因此只要還有第二個未刪除的管理角色，就允許刪除這一個。
 */
export const isLastAdminCapableRole = (roleId: string, adminRoles: readonly AdminCapableRole[]): boolean =>
  adminRoles.some((role) => role.id === roleId) && adminRoles.every((role) => role.id === roleId)

/**
 * 停用這個角色會不會讓公司再也沒有**可用的**管理角色。
 *
 * 這裡與刪除不同，只算 `ACTIVE` 的：已停用的管理角色現在授不出任何權限，
 * 把它算進來等於允許「停用最後一個能用的管理角色，剩下一個同樣停用的」——公司一樣被鎖在門外。
 */
export const wouldDeactivateLastAdminCapableRole = (
  roleId: string,
  adminRoles: readonly AdminCapableRole[],
): boolean => {
  const activeAdminRoles = adminRoles.filter((role) => role.status === 'ACTIVE')
  return activeAdminRoles.some((role) => role.id === roleId) && activeAdminRoles.every((role) => role.id === roleId)
}
