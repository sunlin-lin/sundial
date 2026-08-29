/** 職務主檔的端點 handler（§1.8.0）。形狀比照 `job-titles/main/job-titles-main.handler.ts`。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { JobPositionsMainContext } from './domain/job-position-context.ts'
import type {
  CreateJobPositionInput,
  JobPositionDetail,
  JobPositionListPage,
  JobPositionListQuery,
  JobPositionStatusValue,
  UpdateJobPositionInput,
} from './domain/job-position-model.ts'
import {
  createJobPosition,
  deleteJobPosition,
  getJobPosition,
  listJobPositions,
  updateJobPosition,
} from './job-positions-main.service.ts'

export type JobPositionsMainDependencies = Omit<JobPositionsMainContext, 'companyId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('職務端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toJobPositionContext = (
  dependencies: JobPositionsMainDependencies,
  identity: VerifiedIdentity,
): JobPositionsMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
})

const toJobPositionDetailData = (jobPosition: JobPositionDetail) => ({
  id: jobPosition.id,
  isSystem: jobPosition.isSystem,
  code: jobPosition.code,
  name: jobPosition.name,
  description: jobPosition.description,
  status: jobPosition.status,
  createdAt: jobPosition.createdAt,
  updatedAt: jobPosition.updatedAt,
})

const toNullableJobPositionDetailData = (jobPosition: JobPositionDetail | null) =>
  jobPosition === null ? null : toJobPositionDetailData(jobPosition)

type ListBody = {
  readonly keyword?: string
  readonly perPage: number
  readonly currentPage: number
}

type TargetBody = { readonly id: string }

type CreateBody = {
  readonly code: string
  readonly name: string
  readonly description?: string
}

type UpdateBody = TargetBody & {
  readonly code: string
  readonly name: string
  readonly description?: string
  readonly status: JobPositionStatusValue
}

const toSearchEcho = (body: ListBody) => ({
  ...(body.keyword === undefined ? {} : { keyword: body.keyword }),
})

const toCreateInput = (body: CreateBody): CreateJobPositionInput => ({
  code: body.code,
  name: body.name,
  description: body.description ?? null,
})

const toUpdateInput = (body: UpdateBody): UpdateJobPositionInput => ({
  id: body.id,
  code: body.code,
  name: body.name,
  description: body.description ?? null,
  status: body.status,
})

const toJobPositionListData = (body: ListBody, page: JobPositionListPage) =>
  toListView(
    toSearchEcho(body),
    { field: 'code', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toJobPositionDetailData),
  )

export type JobPositionDetailData = ReturnType<typeof toJobPositionDetailData>
export type JobPositionListData = ReturnType<typeof toJobPositionListData>
export type DeletedJobPositionData = { readonly id: string }

export const handleJobPositionList = async (
  dependencies: JobPositionsMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<JobPositionListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: JobPositionListQuery = {
    keyword: context.body.keyword ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  }
  const result = await listJobPositions(toJobPositionContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toJobPositionListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobPositionGet = async (
  dependencies: JobPositionsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<JobPositionDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getJobPosition(toJobPositionContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableJobPositionDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobPositionCreate = async (
  dependencies: JobPositionsMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<JobPositionDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createJobPosition(toJobPositionContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toJobPositionDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobPositionUpdate = async (
  dependencies: JobPositionsMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<JobPositionDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateJobPosition(toJobPositionContext(dependencies, identity), toUpdateInput(context.body))
  const outcome = resolveServiceResult(result, toJobPositionDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobPositionDelete = async (
  dependencies: JobPositionsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedJobPositionData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteJobPosition(toJobPositionContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}
