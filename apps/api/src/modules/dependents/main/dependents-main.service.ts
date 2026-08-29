/** 眷屬的業務入口（§0.4）。 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { DependentsMainContext } from './domain/dependent-context.ts'
import type {
  CreateDependentInput,
  DependentDetail,
  DependentListPage,
  DependentListQuery,
  TerminateDependentInput,
} from './domain/dependent-model.ts'
import { createDependentInTransaction as createDependentInTransactionImpl } from './impl/dependents-main.create.service.ts'
import { listDependents as listDependentsImpl } from './impl/dependents-main.list.service.ts'
import { terminateDependentInTransaction as terminateDependentInTransactionImpl } from './impl/dependents-main.terminate.service.ts'

export type { DependentsMainContext }
export type {
  CreateDependentInput,
  DependentDetail,
  DependentListPage,
  DependentListQuery,
  TerminateDependentInput,
} from './domain/dependent-model.ts'

/** 新增眷屬。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createDependent = (
  context: DependentsMainContext,
  input: CreateDependentInput,
): Promise<ServiceResult<DependentDetail>> =>
  context.db.transaction((tx) => createDependentInTransactionImpl(tx, context, input))

/** 新增眷屬。收外部交易 handle，給日後跨模組編排點用（形狀比照 `employments` 的同名動作）。 */
export const createDependentInTransaction = (
  tx: TransactionRunner,
  context: DependentsMainContext,
  input: CreateDependentInput,
): Promise<ServiceResult<DependentDetail>> => createDependentInTransactionImpl(tx, context, input)

/** 終止扶養。自己開交易，給單一端點用。 */
export const terminateDependent = (
  context: DependentsMainContext,
  input: TerminateDependentInput,
): Promise<ServiceResult<DependentDetail>> =>
  context.db.transaction((tx) => terminateDependentInTransactionImpl(tx, context, input))

/** 終止扶養。收外部交易 handle，給日後跨模組編排點用。 */
export const terminateDependentInTransaction = (
  tx: TransactionRunner,
  context: DependentsMainContext,
  input: TerminateDependentInput,
): Promise<ServiceResult<DependentDetail>> => terminateDependentInTransactionImpl(tx, context, input)

export const listDependents = (
  context: DependentsMainContext,
  query: DependentListQuery,
): Promise<ServiceResult<DependentListPage>> => listDependentsImpl(context, query)
