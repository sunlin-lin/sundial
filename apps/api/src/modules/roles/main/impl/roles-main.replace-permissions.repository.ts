/**
 * 資料存取：把某個角色的權限指派整組換成新的一組。
 *
 * **作法是「先刪光該角色既有的 `role_permissions`，再寫入新的」**（已定案）。
 * 不做差集比對的理由：差集要多維護一段「哪些要刪、哪些要留、哪些要加」的邏輯，而它算錯時的症狀
 * 是「權限少了一個」或「多了一個」——兩者都不會報錯，只會在某個使用者點不到某個功能時才被發現。
 * 整組換掉沒有這個判斷，也就沒有算錯的空間；而 `role_permissions` 是純關聯、不帶任何歷史意義
 * （誰在什麼時候指派了哪個角色，記在 `company_user_roles`），因此實體刪除不違反 §4.3
 * 「禁止對有歷史意義的資料做實體 DELETE」。
 *
 * **呼叫端必須與角色本身的寫入放在同一個交易內**（§4.4）：只成功一半會留下「角色建好了、
 * 但一個權限也沒有」這種永遠用不了、也沒人會發現的半成品。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { rolePermissions } from '../../../../db/schema/index.ts'

export const replaceRolePermissions = async (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  permissionIds: readonly string[],
  now: string,
): Promise<void> => {
  const tenant = new TenantDatabase(runner, companyId)

  // DELETE 與批次 INSERT 都走 §4.2 的封裝。這兩句原本是**全模組唯一兩處**自己把 `companyId`
  // 寫進 `WHERE`／寫進列裡的地方，理由是封裝當時既不提供 delete 也不提供批次 insert。
  // 那個缺口的風險與其他地方不同一個量級：漏掉公司條件的 SELECT 只是多看到別家資料，
  // 這裡漏掉是**刪掉別家公司的授權**，而且刪完不會有任何錯誤，是對方下次登入才會發現。
  await tenant.delete(rolePermissions, eq(rolePermissions.roleId, roleId))

  // 一次寫入整批，不在迴圈裡逐筆 insert（§4.5）：一個角色數十個權限，逐筆等於數十次往返。
  // 回呼拿到的 `scopedCompanyId` 來自封裝內部，呼叫端寫不出別的公司 ID。
  // 空陣列由 `insertMany` 自己擋掉（`INSERT ... VALUES ()` 不是合法語句）。
  await tenant.insertMany(rolePermissions, (scopedCompanyId) =>
    permissionIds.map((permissionId) => ({
      companyId: scopedCompanyId,
      roleId,
      permissionId,
      createdAt: now,
    })),
  )
}
