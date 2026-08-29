/** 眷屬的端點 handler（§1.8.0）。形狀比照 `employments-main.handler.ts`，不重述。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { DependentsMainContext } from './domain/dependent-context.ts'
import type {
  CreateDependentInput,
  DependentDetail,
  DependentListPage,
  DependentRelationshipCodeValue,
} from './domain/dependent-model.ts'
import { createDependent, listDependents, terminateDependent } from './dependents-main.service.ts'

export type DependentsMainDependencies = Omit<DependentsMainContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('眷屬端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toDependentsContext = (
  dependencies: DependentsMainDependencies,
  identity: VerifiedIdentity,
): DependentsMainContext => ({
  db: dependencies.db,
  cipher: dependencies.cipher,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toDetailData = (dependent: DependentDetail) => ({
  id: dependent.id,
  employeeId: dependent.employeeId,
  name: dependent.name,
  identityNumberMasked: dependent.identityNumberMasked,
  birthdayMasked: dependent.birthdayMasked,
  relationshipCode: dependent.relationshipCode,
  isStudent: dependent.isStudent,
  isDisabled: dependent.isDisabled,
  isUnableToWork: dependent.isUnableToWork,
  isCohabiting: dependent.isCohabiting,
  effectiveDate: dependent.effectiveDate,
  endDate: dependent.endDate,
  status: dependent.status,
  createdAt: dependent.createdAt,
  updatedAt: dependent.updatedAt,
})

type CreateBody = {
  readonly employeeId: string
  readonly name: string
  readonly identityNumber: string
  readonly birthday: string
  readonly relationshipCode: DependentRelationshipCodeValue
  readonly isStudent: boolean
  readonly isDisabled: boolean
  readonly isUnableToWork: boolean
  readonly isCohabiting: boolean
  readonly effectiveDate: string
}

type TerminateBody = {
  readonly id: string
  readonly endDate: string
}

type ListBody = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

const toCreateInput = (body: CreateBody): CreateDependentInput => ({
  employeeId: body.employeeId,
  name: body.name,
  identityNumber: body.identityNumber,
  birthday: body.birthday,
  relationshipCode: body.relationshipCode,
  isStudent: body.isStudent,
  isDisabled: body.isDisabled,
  isUnableToWork: body.isUnableToWork,
  isCohabiting: body.isCohabiting,
  effectiveDate: body.effectiveDate,
})

const toListData = (body: ListBody, page: DependentListPage) =>
  toListView(
    { employeeId: body.employeeId },
    { field: 'effectiveDate', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toDetailData),
  )

export type DependentDetailData = ReturnType<typeof toDetailData>
export type DependentListData = ReturnType<typeof toListData>

export const handleDependentCreate = async (
  dependencies: DependentsMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<DependentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createDependent(toDependentsContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDependentTerminate = async (
  dependencies: DependentsMainDependencies,
  context: EndpointContext<TerminateBody>,
): Promise<EndpointResult<DependentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await terminateDependent(toDependentsContext(dependencies, identity), {
    id: context.body.id,
    endDate: context.body.endDate,
  })
  const outcome = resolveServiceResult(result, toDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDependentList = async (
  dependencies: DependentsMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<DependentListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listDependents(toDependentsContext(dependencies, identity), {
    employeeId: context.body.employeeId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}
