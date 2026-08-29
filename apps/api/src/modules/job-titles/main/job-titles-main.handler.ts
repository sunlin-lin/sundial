/**
 * 職稱主檔的端點 handler（§1.8.0）。形狀比照 `departments/main/departments-main.handler.ts`。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { JobTitlesMainContext } from './domain/job-title-context.ts'
import type {
  CreateJobTitleInput,
  JobTitleDetail,
  JobTitleListPage,
  JobTitleListQuery,
  JobTitleStatusValue,
  UpdateJobTitleInput,
} from './domain/job-title-model.ts'
import {
  createJobTitle,
  deleteJobTitle,
  getJobTitle,
  listJobTitles,
  updateJobTitle,
} from './job-titles-main.service.ts'

export type JobTitlesMainDependencies = Omit<JobTitlesMainContext, 'companyId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('職稱端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toJobTitleContext = (
  dependencies: JobTitlesMainDependencies,
  identity: VerifiedIdentity,
): JobTitlesMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
})

const toJobTitleDetailData = (jobTitle: JobTitleDetail) => ({
  id: jobTitle.id,
  isSystem: jobTitle.isSystem,
  code: jobTitle.code,
  name: jobTitle.name,
  description: jobTitle.description,
  status: jobTitle.status,
  createdAt: jobTitle.createdAt,
  updatedAt: jobTitle.updatedAt,
})

const toNullableJobTitleDetailData = (jobTitle: JobTitleDetail | null) =>
  jobTitle === null ? null : toJobTitleDetailData(jobTitle)

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
  readonly status: JobTitleStatusValue
}

const toSearchEcho = (body: ListBody) => ({
  ...(body.keyword === undefined ? {} : { keyword: body.keyword }),
})

const toCreateInput = (body: CreateBody): CreateJobTitleInput => ({
  code: body.code,
  name: body.name,
  description: body.description ?? null,
})

const toUpdateInput = (body: UpdateBody): UpdateJobTitleInput => ({
  id: body.id,
  code: body.code,
  name: body.name,
  description: body.description ?? null,
  status: body.status,
})

const toJobTitleListData = (body: ListBody, page: JobTitleListPage) =>
  toListView(
    toSearchEcho(body),
    { field: 'code', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toJobTitleDetailData),
  )

export type JobTitleDetailData = ReturnType<typeof toJobTitleDetailData>
export type JobTitleListData = ReturnType<typeof toJobTitleListData>
export type DeletedJobTitleData = { readonly id: string }

export const handleJobTitleList = async (
  dependencies: JobTitlesMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<JobTitleListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: JobTitleListQuery = {
    keyword: context.body.keyword ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  }
  const result = await listJobTitles(toJobTitleContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toJobTitleListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobTitleGet = async (
  dependencies: JobTitlesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<JobTitleDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getJobTitle(toJobTitleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableJobTitleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobTitleCreate = async (
  dependencies: JobTitlesMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<JobTitleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createJobTitle(toJobTitleContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toJobTitleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobTitleUpdate = async (
  dependencies: JobTitlesMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<JobTitleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateJobTitle(toJobTitleContext(dependencies, identity), toUpdateInput(context.body))
  const outcome = resolveServiceResult(result, toJobTitleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobTitleDelete = async (
  dependencies: JobTitlesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedJobTitleData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteJobTitle(toJobTitleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}
