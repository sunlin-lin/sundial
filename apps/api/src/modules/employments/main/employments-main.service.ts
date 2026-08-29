/**
 * 任職主檔的業務入口（§0.4）。形狀與理由比照 `departments-main.service.ts`，不重述。
 */
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
import { createEmployment as createEmploymentImpl } from './impl/employments-main.create.service.ts'
import { getEmployment as getEmploymentImpl } from './impl/employments-main.get.service.ts'
import { leaveEmployment as leaveEmploymentImpl } from './impl/employments-main.leave.service.ts'
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

export const createEmployment = (
  context: EmploymentsMainContext,
  input: CreateEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => createEmploymentImpl(context, input)

export const getEmployment = (
  context: EmploymentsMainContext,
  input: EmploymentTargetInput,
): Promise<ServiceResult<EmploymentDetail | null>> => getEmploymentImpl(context, input)

export const listEmployments = (
  context: EmploymentsMainContext,
  query: EmploymentListQuery,
): Promise<ServiceResult<EmploymentListPage>> => listEmploymentsImpl(context, query)

export const leaveEmployment = (
  context: EmploymentsMainContext,
  input: LeaveEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => leaveEmploymentImpl(context, input)
