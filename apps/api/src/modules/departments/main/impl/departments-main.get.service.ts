/**
 * 業務動作：查詢單一部門。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」），**別家公司的部門也回 `null`**，且兩者走的是
 * 同一行程式碼（§3.2）：公司條件由 `TenantDatabase` 寫進 `WHERE`，「存在但不屬於你」與
 * 「不存在」想寫出不一樣的回應都寫不出來。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentsMainContext } from '../domain/department-context.ts'
import type { DepartmentDetail, DepartmentTargetInput } from '../domain/department-model.ts'
import { findDepartmentDetail } from '../departments-main.repository.ts'

export const getDepartment = async (
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DepartmentDetail | null>> =>
  succeed(await findDepartmentDetail(context.db, context.companyId, input.id))
