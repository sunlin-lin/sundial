/**
 * 角色主檔的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 這裡的「動作」是**資料存取動作，不是端點動作**（§0.4）：`findRoleDetail` 被 5 支端點共用，
 * `listAdminCapableRoles` 被 2 支共用。以端點為單位切，同一段查詢就會被複製進好幾個切片
 * （改一處漏一處，而且不會有任何地方變紅），或者切片開始互相 import（§0.4 禁止）。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { AdminCapableRole } from './domain/admin-capability.ts'
import type { RoleDetail, RoleListPage, RoleListQuery } from './domain/role-model.ts'
import { findRoleDetail as findRoleDetailImpl } from './impl/roles-main.find.repository.ts'
import { insertRole as insertRoleImpl, type NewRole, type RoleInsertOutcome } from './impl/roles-main.insert.repository.ts'
import { listAdminCapableRoles as listAdminCapableRolesImpl } from './impl/roles-main.list-admin-roles.repository.ts'
import { listRolePage as listRolePageImpl } from './impl/roles-main.list.repository.ts'
import { markRoleDeleted as markRoleDeletedImpl, type RoleDeletion } from './impl/roles-main.mark-deleted.repository.ts'
import { replaceRolePermissions as replaceRolePermissionsImpl } from './impl/roles-main.replace-permissions.repository.ts'
import {
  updateRoleProfile as updateRoleProfileImpl,
  type RoleProfileUpdate,
} from './impl/roles-main.update-profile.repository.ts'
import {
  updateRoleStatus as updateRoleStatusImpl,
  type RoleStatusIntent,
} from './impl/roles-main.update-status.repository.ts'

export type { NewRole, RoleDeletion, RoleInsertOutcome, RoleProfileUpdate, RoleStatusIntent }

/**
 * 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。
 *
 * **刻意不在這裡另外宣告一份更窄的 `Pick<Database, …>`。** 原本每個模組各自宣告一份，
 * 三份的內容還互不相同，而 `TenantDatabase` 要的又是第四份——於是每個模組都有一批切片
 * 無法把 runner 交給封裝，只能退回裸 runner 自己在 `WHERE` 裡手寫 `companyId`。
 * 這裡轉出正典型別，是為了讓「拿得到 runner」與「用得到封裝」永遠是同一件事。
 */
export type { QueryRunner }

export const listRolePage = (
  runner: QueryRunner,
  companyId: string,
  query: RoleListQuery,
): Promise<RoleListPage> => listRolePageImpl(runner, companyId, query)

export const findRoleDetail = (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
): Promise<RoleDetail | null> => findRoleDetailImpl(runner, companyId, roleId)

export const listAdminCapableRoles = (
  runner: QueryRunner,
  companyId: string,
): Promise<readonly AdminCapableRole[]> => listAdminCapableRolesImpl(runner, companyId)

export const insertRole = (runner: QueryRunner, companyId: string, role: NewRole): Promise<RoleInsertOutcome> =>
  insertRoleImpl(runner, companyId, role)

export const updateRoleProfile = (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  profile: RoleProfileUpdate,
): Promise<void> => updateRoleProfileImpl(runner, companyId, roleId, profile)

export const replaceRolePermissions = (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  permissionIds: readonly string[],
  now: string,
): Promise<void> => replaceRolePermissionsImpl(runner, companyId, roleId, permissionIds, now)

export const markRoleDeleted = (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  deletion: RoleDeletion,
): Promise<number> => markRoleDeletedImpl(runner, companyId, roleId, deletion)

export const updateRoleStatus = (
  runner: QueryRunner,
  companyId: string,
  roleId: string,
  intent: RoleStatusIntent,
  now: string,
): Promise<number> => updateRoleStatusImpl(runner, companyId, roleId, intent, now)
