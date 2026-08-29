/**
 * 任職主檔的端點 handler（§1.8.0 的④與⑥）。形狀與理由比照 `departments-main.handler.ts`，不重述。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { EmploymentsMainContext } from './domain/employment-context.ts'
import { resolveEmploymentSort } from './domain/employment-list-view.ts'
import type {
  CreateEmploymentInput,
  EmploymentDetail,
  EmploymentListPage,
  EmploymentListQuery,
  EmploymentTypeCodeValue,
  LeaveEmploymentInput,
} from './domain/employment-model.ts'
import { createEmployment, getEmployment, leaveEmployment, listEmployments } from './employments-main.service.ts'

/** 由組裝點注入的相依。公司範圍與操作者都不在裡面——只能來自每一次請求的已驗證身分。 */
export type EmploymentsMainDependencies = Omit<EmploymentsMainContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('任職端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toEmploymentContext = (
  dependencies: EmploymentsMainDependencies,
  identity: VerifiedIdentity,
): EmploymentsMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toEmploymentDetailData = (employment: EmploymentDetail) => ({
  id: employment.id,
  employeeId: employment.employeeId,
  employmentTypeCode: employment.employmentTypeCode,
  employmentNatureCode: employment.employmentNatureCode,
  hireDate: employment.hireDate,
  leaveDate: employment.leaveDate,
  lastWorkingDate: employment.lastWorkingDate,
  leaveReasonCode: employment.leaveReasonCode,
  status: employment.status,
  createdAt: employment.createdAt,
  updatedAt: employment.updatedAt,
})

const toNullableEmploymentDetailData = (employment: EmploymentDetail | null) =>
  employment === null ? null : toEmploymentDetailData(employment)

type TargetBody = { readonly id: string }

type CreateBody = {
  readonly employeeId: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode?: number
  readonly hireDate: string
}

type LeaveBody = {
  readonly id: string
  readonly leaveDate: string
  readonly lastWorkingDate: string
  readonly leaveReasonCode: number
}

type ListBody = {
  readonly employeeId?: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: string; readonly order: 'asc' | 'desc' }
}

const toCreateInput = (body: CreateBody): CreateEmploymentInput => ({
  employeeId: body.employeeId,
  employmentTypeCode: body.employmentTypeCode,
  employmentNatureCode: body.employmentNatureCode ?? null,
  hireDate: body.hireDate,
})

const toLeaveInput = (body: LeaveBody): LeaveEmploymentInput => ({
  id: body.id,
  leaveDate: body.leaveDate,
  lastWorkingDate: body.lastWorkingDate,
  leaveReasonCode: body.leaveReasonCode,
})

/** 回聲用：使用者沒送的條件就不出現（§1.4），理由與 `employees-main.handler.ts` 的同名函式相同。 */
const toSearchEcho = (body: ListBody) => ({
  ...(body.employeeId === undefined ? {} : { employeeId: body.employeeId }),
})

const toEmploymentListData = (query: EmploymentListQuery, body: ListBody, page: EmploymentListPage) =>
  toListView(
    toSearchEcho(body),
    query.sort,
    { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
    page.items.map(toEmploymentDetailData),
  )

export type EmploymentDetailData = ReturnType<typeof toEmploymentDetailData>
export type EmploymentListData = ReturnType<typeof toEmploymentListData>

export const handleEmploymentGet = async (
  dependencies: EmploymentsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<EmploymentDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getEmployment(toEmploymentContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableEmploymentDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmploymentList = async (
  dependencies: EmploymentsMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<EmploymentListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: EmploymentListQuery = {
    employeeId: context.body.employeeId ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: resolveEmploymentSort(context.body.sort),
  }

  const result = await listEmployments(toEmploymentContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toEmploymentListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmploymentCreate = async (
  dependencies: EmploymentsMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<EmploymentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createEmployment(toEmploymentContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toEmploymentDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmploymentLeave = async (
  dependencies: EmploymentsMainDependencies,
  context: EndpointContext<LeaveBody>,
): Promise<EndpointResult<EmploymentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await leaveEmployment(toEmploymentContext(dependencies, identity), toLeaveInput(context.body))
  const outcome = resolveServiceResult(result, toEmploymentDetailData)
  context.set.status = outcome.status
  return outcome.body
}
