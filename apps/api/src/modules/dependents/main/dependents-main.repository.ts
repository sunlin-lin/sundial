/**
 * 眷屬的資料存取入口（§0.4）。**不再需要欄位加解密器**：眷屬個資已改回明文儲存（改由資料庫端
 * 靜態加密負責，見 `db/schema/employee-dependents.ts` 檔頭「敏感欄位改回明文」）。
 */
import type { QueryRunner } from '../../../db/client.ts'
import type { DependentInsertOutcome } from './domain/dependent-duplicate.ts'
import type { DependentListPage, DependentListQuery } from './domain/dependent-model.ts'
import type { DependentRow } from './domain/dependent-secrets.ts'
import { findDependentRow as findDependentRowImpl } from './impl/dependents-main.find.repository.ts'
import { findEmployeeForReference as findEmployeeForReferenceImpl } from './impl/dependents-main.find-employee.repository.ts'
import { insertDependent as insertDependentImpl, type NewDependent } from './impl/dependents-main.insert.repository.ts'
import { listDependentPage as listDependentPageImpl } from './impl/dependents-main.list.repository.ts'
import {
  markDependentTerminated as markDependentTerminatedImpl,
  type TerminateUpdate,
} from './impl/dependents-main.update-terminate.repository.ts'

export type { NewDependent, TerminateUpdate }
export type { QueryRunner }

export const findEmployeeForReference = (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => findEmployeeForReferenceImpl(runner, companyId, employeeId)

export const insertDependent = (
  runner: QueryRunner,
  companyId: string,
  dependent: NewDependent,
): Promise<DependentInsertOutcome> => insertDependentImpl(runner, companyId, dependent)

export const listDependentPage = (
  runner: QueryRunner,
  companyId: string,
  query: DependentListQuery,
): Promise<DependentListPage> => listDependentPageImpl(runner, companyId, query)

export const findDependentRow = (
  runner: QueryRunner,
  companyId: string,
  dependentId: string,
): Promise<DependentRow | null> => findDependentRowImpl(runner, companyId, dependentId)

export const markDependentTerminated = (
  runner: QueryRunner,
  companyId: string,
  dependentId: string,
  update: TerminateUpdate,
): Promise<number> => markDependentTerminatedImpl(runner, companyId, dependentId, update)
