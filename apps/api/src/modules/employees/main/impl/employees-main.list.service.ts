/**
 * 業務動作：查詢員工清單。
 *
 * 查詢類端點**沒有業務錯誤**（§3.1.3）：查無資料是一個正常且有效的答案，回空清單而不是錯誤
 * ——當成錯誤的話，前端就得為「這組條件查不到資料」寫錯誤處理。跨公司存取同樣落在這條路徑上：
 * 公司條件寫在 `WHERE` 裡，別家公司的員工在查詢階段就等同於不存在（§3.2、§4.2）。
 */
import { succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { EmployeeListPage, EmployeeListQuery } from '../domain/employee-model.ts'
import { listEmployeePage } from '../employees-main.repository.ts'

export const listEmployees = async (
  context: EmployeesMainContext,
  query: EmployeeListQuery,
): Promise<ServiceResult<EmployeeListPage>> =>
  // `today`（§6.2：由注入的 clock 取得，不在 repository 內部呼叫 `new Date()`）決定「目前有效
  // 職稱」的判斷基準（見 `impl/employees-main.list.repository.ts` 的批次查詢）。
  succeed(await listEmployeePage(context.db, context.cipher, context.companyId, context.clock.today(), query))
