/**
 * 角色主檔的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 * 一旦實作開始往入口裡放，這個「一頁看完」的功能就消失了，而它消失得很安靜——
 * 檔案只是一天比一天長，沒有任何一天會有人說「就是今天壞的」。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：
 * 業務拒絕一律以 `ServiceResult` 的失敗結果 ＋ 具名分組表達。那不是為了好看——
 * 同一段規則將來被第二種入口（排程、匯入、對外介接）呼叫時，那些情境根本沒有這包 envelope，
 * 而狀態碼體系是入口的事（§1.0.1）。
 */
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { RolesMainContext } from './domain/role-context.ts'
import type {
  CreateRoleInput,
  DeletedRole,
  RoleDetail,
  RoleListPage,
  RoleListQuery,
  RoleTargetInput,
  UpdateRoleInput,
} from './domain/role-model.ts'
import { activateRole as activateRoleImpl } from './impl/roles-main.activate.service.ts'
import { createRole as createRoleImpl } from './impl/roles-main.create.service.ts'
import { deactivateRole as deactivateRoleImpl } from './impl/roles-main.deactivate.service.ts'
import { deleteRole as deleteRoleImpl } from './impl/roles-main.delete.service.ts'
import { getRole as getRoleImpl } from './impl/roles-main.get.service.ts'
import { listRoles as listRolesImpl } from './impl/roles-main.list.service.ts'
import { updateRole as updateRoleImpl } from './impl/roles-main.update.service.ts'

export type { RolesMainContext }
export type {
  CreateRoleInput,
  DeletedRole,
  RoleDetail,
  RoleListPage,
  RoleListQuery,
  RoleSortOption,
  RoleSummary,
  RoleTargetInput,
  UpdateRoleInput,
} from './domain/role-model.ts'

export const listRoles = (context: RolesMainContext, query: RoleListQuery): Promise<ServiceResult<RoleListPage>> =>
  listRolesImpl(context, query)

export const getRole = (
  context: RolesMainContext,
  input: RoleTargetInput,
): Promise<ServiceResult<RoleDetail | null>> => getRoleImpl(context, input)

export const createRole = (context: RolesMainContext, input: CreateRoleInput): Promise<ServiceResult<RoleDetail>> =>
  createRoleImpl(context, input)

export const updateRole = (context: RolesMainContext, input: UpdateRoleInput): Promise<ServiceResult<RoleDetail>> =>
  updateRoleImpl(context, input)

export const deleteRole = (context: RolesMainContext, input: RoleTargetInput): Promise<ServiceResult<DeletedRole>> =>
  deleteRoleImpl(context, input)

export const activateRole = (context: RolesMainContext, input: RoleTargetInput): Promise<ServiceResult<RoleDetail>> =>
  activateRoleImpl(context, input)

export const deactivateRole = (context: RolesMainContext, input: RoleTargetInput): Promise<ServiceResult<RoleDetail>> =>
  deactivateRoleImpl(context, input)
