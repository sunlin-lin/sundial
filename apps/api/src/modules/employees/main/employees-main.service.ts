/**
 * 員工主檔的業務入口（§0.4）。
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
import type { EmployeesMainContext } from './domain/employee-context.ts'
import type {
  CreateEmployeeInput,
  DeletedEmployee,
  EmployeeDetail,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeTargetInput,
  UpdateEmployeeInput,
} from './domain/employee-model.ts'
import { createEmployee as createEmployeeImpl } from './impl/employees-main.create.service.ts'
import { deleteEmployee as deleteEmployeeImpl } from './impl/employees-main.delete.service.ts'
import { getEmployee as getEmployeeImpl } from './impl/employees-main.get.service.ts'
import { listEmployees as listEmployeesImpl } from './impl/employees-main.list.service.ts'
import { updateEmployee as updateEmployeeImpl } from './impl/employees-main.update.service.ts'

export type { EmployeesMainContext }
export type {
  CreateEmployeeInput,
  DeletedEmployee,
  EmployeeDetail,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeProfileInput,
  EmployeeSortOption,
  EmployeeSummary,
  EmployeeTargetInput,
  GenderValue,
  UpdateEmployeeInput,
} from './domain/employee-model.ts'

export const listEmployees = (
  context: EmployeesMainContext,
  query: EmployeeListQuery,
): Promise<ServiceResult<EmployeeListPage>> => listEmployeesImpl(context, query)

export const getEmployee = (
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<EmployeeDetail | null>> => getEmployeeImpl(context, input)

export const createEmployee = (
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => createEmployeeImpl(context, input)

export const updateEmployee = (
  context: EmployeesMainContext,
  input: UpdateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => updateEmployeeImpl(context, input)

export const deleteEmployee = (
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<DeletedEmployee>> => deleteEmployeeImpl(context, input)
