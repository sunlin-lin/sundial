/**
 * 部門主檔的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { DepartmentsMainContext } from './domain/department-context.ts'
import type {
  CreateDepartmentInput,
  DeletedDepartment,
  DepartmentDetail,
  DepartmentTargetInput,
  DepartmentTreeNode,
  UpdateDepartmentInput,
} from './domain/department-model.ts'
import { createDepartmentInTransaction as createDepartmentInTransactionImpl } from './impl/departments-main.create.service.ts'
import { deleteDepartmentInTransaction as deleteDepartmentInTransactionImpl } from './impl/departments-main.delete.service.ts'
import { getDepartment as getDepartmentImpl } from './impl/departments-main.get.service.ts'
import { getDepartmentTree as getDepartmentTreeImpl } from './impl/departments-main.tree.service.ts'
import { updateDepartmentInTransaction as updateDepartmentInTransactionImpl } from './impl/departments-main.update.service.ts'

export type { DepartmentsMainContext }
export type {
  CreateDepartmentInput,
  DeletedDepartment,
  DepartmentDetail,
  DepartmentNode,
  DepartmentTargetInput,
  DepartmentTreeNode,
  UpdateDepartmentInput,
} from './domain/department-model.ts'

export const getDepartmentTree = (
  context: DepartmentsMainContext,
): Promise<ServiceResult<readonly DepartmentTreeNode[]>> => getDepartmentTreeImpl(context)

export const getDepartment = (
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DepartmentDetail | null>> => getDepartmentImpl(context, input)

/** 新增部門。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createDepartment = (
  context: DepartmentsMainContext,
  input: CreateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> =>
  context.db.transaction((tx) => createDepartmentInTransactionImpl(tx, context, input))

/** 新增部門。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const createDepartmentInTransaction = (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: CreateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => createDepartmentInTransactionImpl(tx, context, input)

/** 修改部門。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const updateDepartment = (
  context: DepartmentsMainContext,
  input: UpdateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> =>
  context.db.transaction((tx) => updateDepartmentInTransactionImpl(tx, context, input))

/** 修改部門。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const updateDepartmentInTransaction = (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: UpdateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => updateDepartmentInTransactionImpl(tx, context, input)

/** 刪除部門（軟刪除）。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const deleteDepartment = (
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DeletedDepartment>> =>
  context.db.transaction((tx) => deleteDepartmentInTransactionImpl(tx, context, input))

/** 刪除部門。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const deleteDepartmentInTransaction = (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DeletedDepartment>> => deleteDepartmentInTransactionImpl(tx, context, input)
