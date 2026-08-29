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
import type { TransactionRunner } from '../../../db/client.ts'
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
import { createEmployeeInTransaction as createEmployeeInTransactionImpl } from './impl/employees-main.create.service.ts'
import { deleteEmployeeInTransaction as deleteEmployeeInTransactionImpl } from './impl/employees-main.delete.service.ts'
import { getEmployee as getEmployeeImpl } from './impl/employees-main.get.service.ts'
import { listEmployees as listEmployeesImpl } from './impl/employees-main.list.service.ts'
import { updateEmployeeInTransaction as updateEmployeeInTransactionImpl } from './impl/employees-main.update.service.ts'

export type { EmployeesMainContext }
export type {
  CreateEmployeeInput,
  DeletedEmployee,
  EmployeeDetail,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeProfileInput,
  EmployeeProfileUpdateInput,
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

/**
 * 新增員工。**自己開交易**，給單一端點（`/employees/main/create`）用。
 *
 * 與 {@link createEmployeeInTransaction} 的差別必須從簽章上就看得出來（計畫 §4.2 抱怨過
 *「兩支端點都叫 create，呼叫端從簽章上看不出差別」，這裡不重蹈）：這支不收 `tx`，
 * 交易邊界在這一層；那支收 `tx` 作為第一個參數，跟著呼叫端已經開好的交易走。
 */
export const createEmployee = (
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> =>
  context.db.transaction((tx) => createEmployeeInTransactionImpl(tx, context, input))

/**
 * 新增員工。**收外部交易 handle，不自己開交易**（計畫 §4.1），給 Stage 4 的
 * `employees/onboarding` 編排點用——那裡要把這支動作與任職、部門、帳號等其他模組的寫入
 * 包進同一個交易，任一步失敗時整筆取消。
 */
export const createEmployeeInTransaction = (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => createEmployeeInTransactionImpl(tx, context, input)

/** 修改員工。自己開交易，給單一端點用；差別見 {@link createEmployee} 的說明。 */
export const updateEmployee = (
  context: EmployeesMainContext,
  input: UpdateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> =>
  context.db.transaction((tx) => updateEmployeeInTransactionImpl(tx, context, input))

/** 修改員工。收外部交易 handle，給編排點用；差別見 {@link createEmployeeInTransaction} 的說明。 */
export const updateEmployeeInTransaction = (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: UpdateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => updateEmployeeInTransactionImpl(tx, context, input)

/** 刪除員工（軟刪除）。自己開交易，給單一端點用；差別見 {@link createEmployee} 的說明。 */
export const deleteEmployee = (
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<DeletedEmployee>> =>
  context.db.transaction((tx) => deleteEmployeeInTransactionImpl(tx, context, input))

/** 刪除員工。收外部交易 handle，給編排點用；差別見 {@link createEmployeeInTransaction} 的說明。 */
export const deleteEmployeeInTransaction = (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<DeletedEmployee>> => deleteEmployeeInTransactionImpl(tx, context, input)
