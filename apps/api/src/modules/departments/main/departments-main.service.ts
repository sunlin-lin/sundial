/**
 * 部門主檔的業務入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體有哪些動作、
 * 各自收什麼、回什麼，一頁看完；業務規則在 `impl/` 底下，一個動作一個檔。
 *
 * 本層**不得碰 envelope、HTTP status 或 `WebFlowCode`**（§1.8.2、§3.1.1）：業務拒絕一律以
 * `ServiceResult` 的失敗結果 ＋ 具名分組表達。
 */
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
import { createDepartment as createDepartmentImpl } from './impl/departments-main.create.service.ts'
import { deleteDepartment as deleteDepartmentImpl } from './impl/departments-main.delete.service.ts'
import { getDepartment as getDepartmentImpl } from './impl/departments-main.get.service.ts'
import { getDepartmentTree as getDepartmentTreeImpl } from './impl/departments-main.tree.service.ts'
import { updateDepartment as updateDepartmentImpl } from './impl/departments-main.update.service.ts'

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

export const createDepartment = (
  context: DepartmentsMainContext,
  input: CreateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => createDepartmentImpl(context, input)

export const updateDepartment = (
  context: DepartmentsMainContext,
  input: UpdateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => updateDepartmentImpl(context, input)

export const deleteDepartment = (
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DeletedDepartment>> => deleteDepartmentImpl(context, input)
