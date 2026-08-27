/**
 * 業務動作：查詢單一員工。
 *
 * 查無資料回 `null`（§1.3「查無資料不是 404」），**別家公司的員工也回 `null`**，
 * 且兩者走的是同一行程式碼（§3.2）：公司條件由 `TenantDatabase` 寫進 `WHERE`，
 * 「存在但不屬於你」與「不存在」想寫出不一樣的回應都寫不出來。
 *
 * 回傳的敏感欄位**在 repository 就已經遮罩**（§5.1）：本層拿不到明文，因此
 * 「這支端點會不會漏遮罩」不是一個要在 review 時檢查的問題。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { EmployeeDetail, EmployeeTargetInput } from '../domain/employee-model.ts'
import { findEmployeeDetail } from '../employees-main.repository.ts'

export const getEmployee = async (
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<EmployeeDetail | null>> =>
  succeed(await findEmployeeDetail(context.db, context.cipher, context.companyId, input.id))
