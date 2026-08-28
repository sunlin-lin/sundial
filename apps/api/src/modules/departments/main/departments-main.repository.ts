/**
 * 部門主檔的資料存取入口（§0.4）。
 *
 * **每個動作一個函式、每個函式只有一行委派。** 打開這個檔案就知道這個次實體對資料庫做了哪些事、
 * 各自收什麼、回什麼，一頁看完；實作在 `impl/` 底下，一個動作一個檔。
 *
 * 本檔（含 `impl/`）是本模組唯一可以碰資料庫的一層；`*.repository.ts` 也不得被本次目錄以外的
 * 任何檔案 import（§0.3）——要資料一律走 service。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { DepartmentDetail, DepartmentNode } from './domain/department-model.ts'
import { findDepartmentDetail as findDepartmentDetailImpl } from './impl/departments-main.find.repository.ts'
import { hasChildDepartments as hasChildDepartmentsImpl } from './impl/departments-main.has-children.repository.ts'
import {
  insertDepartment as insertDepartmentImpl,
  type NewDepartment,
} from './impl/departments-main.insert.repository.ts'
import { listDepartmentNodes as listDepartmentNodesImpl } from './impl/departments-main.list.repository.ts'
import {
  markDepartmentDeleted as markDepartmentDeletedImpl,
  type DepartmentDeletion,
} from './impl/departments-main.mark-deleted.repository.ts'
import {
  updateDepartmentProfile as updateDepartmentProfileImpl,
  type DepartmentProfileUpdate,
  type DepartmentProfileUpdateOutcome,
} from './impl/departments-main.update-profile.repository.ts'
import type { DepartmentInsertOutcome } from './domain/department-duplicate.ts'

export type { DepartmentDeletion, DepartmentProfileUpdate, DepartmentProfileUpdateOutcome, NewDepartment }

/** 資料存取的執行器，直接沿用 `db/client.ts` 的正典型別（§4.2 的封裝要的就是這一組）。 */
export type { QueryRunner }

export const findDepartmentDetail = (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
): Promise<DepartmentDetail | null> => findDepartmentDetailImpl(runner, companyId, departmentId)

export const listDepartmentNodes = (runner: QueryRunner, companyId: string): Promise<readonly DepartmentNode[]> =>
  listDepartmentNodesImpl(runner, companyId)

export const hasChildDepartments = (runner: QueryRunner, companyId: string, departmentId: string): Promise<boolean> =>
  hasChildDepartmentsImpl(runner, companyId, departmentId)

export const insertDepartment = (
  runner: QueryRunner,
  companyId: string,
  department: NewDepartment,
): Promise<DepartmentInsertOutcome> => insertDepartmentImpl(runner, companyId, department)

export const updateDepartmentProfile = (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
  update: DepartmentProfileUpdate,
): Promise<DepartmentProfileUpdateOutcome> => updateDepartmentProfileImpl(runner, companyId, departmentId, update)

export const markDepartmentDeleted = (
  runner: QueryRunner,
  companyId: string,
  departmentId: string,
  deletion: DepartmentDeletion,
): Promise<number> => markDepartmentDeletedImpl(runner, companyId, departmentId, deletion)
