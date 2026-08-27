/**
 * 業務動作：查詢單一角色。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」），**別家公司的角色也回 `null`**，
 * 且兩者走的是同一行程式碼（§3.2）：公司條件由 `TenantDatabase` 寫進 `WHERE`，
 * 「存在但不屬於你」與「不存在」想寫出不一樣的回應都寫不出來。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { RolesMainContext } from '../domain/role-context.ts'
import type { RoleDetail, RoleTargetInput } from '../domain/role-model.ts'
import { findRoleDetail } from '../roles-main.repository.ts'

export const getRole = async (
  context: RolesMainContext,
  input: RoleTargetInput,
): Promise<ServiceResult<RoleDetail | null>> => succeed(await findRoleDetail(context.db, context.companyId, input.id))
