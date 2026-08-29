/**
 * 任職主檔的業務入口（§0.4）。形狀與理由比照 `departments-main.service.ts`，不重述。
 */
import type { TransactionRunner } from '../../../db/client.ts'
import type { ServiceResult } from '../../../shared/service-result.ts'
import type { EmploymentsMainContext } from './domain/employment-context.ts'
import type {
  CreateEmploymentInput,
  EmploymentDetail,
  EmploymentListPage,
  EmploymentListQuery,
  EmploymentTargetInput,
  LeaveEmploymentInput,
} from './domain/employment-model.ts'
import { createEmploymentInTransaction as createEmploymentInTransactionImpl } from './impl/employments-main.create.service.ts'
import { getEmployment as getEmploymentImpl } from './impl/employments-main.get.service.ts'
import { leaveEmploymentInTransaction as leaveEmploymentInTransactionImpl } from './impl/employments-main.leave.service.ts'
import { listEmployments as listEmploymentsImpl } from './impl/employments-main.list.service.ts'

export type { EmploymentsMainContext }
export type {
  CreateEmploymentInput,
  EmploymentDetail,
  EmploymentListPage,
  EmploymentListQuery,
  EmploymentTargetInput,
  LeaveEmploymentInput,
} from './domain/employment-model.ts'

/** 新增任職。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const createEmployment = (
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> =>
  context.db.transaction((tx) => createEmploymentInTransactionImpl(tx, context, input))

/** 新增任職。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const createEmploymentInTransaction = (
  tx: TransactionRunner,
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => createEmploymentInTransactionImpl(tx, context, input)

export const getEmployment = (
  context: EmploymentsMainContext,
  input: EmploymentTargetInput,
): Promise<ServiceResult<EmploymentDetail | null>> => getEmploymentImpl(context, input)

export const listEmployments = (
  context: EmploymentsMainContext,
  query: EmploymentListQuery,
): Promise<ServiceResult<EmploymentListPage>> => listEmploymentsImpl(context, query)

/** 辦理離職。自己開交易，給單一端點用；差別見 `employees-main.service.ts` 的 `createEmployee` 說明。 */
export const leaveEmployment = (
  context: EmploymentsMainContext,
  input: LeaveEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> =>
  context.db.transaction((tx) => leaveEmploymentInTransactionImpl(tx, context, input))

/** 辦理離職。收外部交易 handle，給 Stage 4 編排點用（計畫 §4.1）。 */
export const leaveEmploymentInTransaction = (
  tx: TransactionRunner,
  context: EmploymentsMainContext,
  input: LeaveEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => leaveEmploymentInTransactionImpl(tx, context, input)
