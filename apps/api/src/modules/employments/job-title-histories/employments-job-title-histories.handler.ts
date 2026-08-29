/** 職稱歷史的端點 handler（§1.8.0）。形狀比照 `department-histories`，但多一支 `create`。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { JobTitleHistoriesContext } from './domain/job-title-history-context.ts'
import type {
  CreateJobTitleHistoryInput,
  JobTitleHistoryDetail,
  JobTitleHistoryListPage,
} from './domain/job-title-history-model.ts'
import { createJobTitleHistory, listJobTitleHistories } from './employments-job-title-histories.service.ts'

export type JobTitleHistoriesDependencies = Omit<JobTitleHistoriesContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('職稱歷史端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toJobTitleHistoriesContext = (
  dependencies: JobTitleHistoriesDependencies,
  identity: VerifiedIdentity,
): JobTitleHistoriesContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toJobTitleHistoryDetailData = (history: JobTitleHistoryDetail) => ({
  id: history.id,
  employmentId: history.employmentId,
  jobTitleId: history.jobTitleId,
  effectiveFrom: history.effectiveFrom,
  effectiveTo: history.effectiveTo,
  createdAt: history.createdAt,
  updatedAt: history.updatedAt,
})

type ListBody = {
  readonly employmentId: string
  readonly perPage: number
  readonly currentPage: number
}

type CreateBody = {
  readonly employmentId: string
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

const toCreateInput = (body: CreateBody): CreateJobTitleHistoryInput => ({
  employmentId: body.employmentId,
  jobTitleId: body.jobTitleId,
  effectiveFrom: body.effectiveFrom,
  effectiveTo: body.effectiveTo ?? null,
})

const toListData = (body: ListBody, page: JobTitleHistoryListPage) =>
  toListView(
    { employmentId: body.employmentId },
    { field: 'effectiveFrom', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toJobTitleHistoryDetailData),
  )

export type JobTitleHistoryDetailData = ReturnType<typeof toJobTitleHistoryDetailData>
export type JobTitleHistoryListData = ReturnType<typeof toListData>

export const handleJobTitleHistoryList = async (
  dependencies: JobTitleHistoriesDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<JobTitleHistoryListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listJobTitleHistories(toJobTitleHistoriesContext(dependencies, identity), {
    employmentId: context.body.employmentId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobTitleHistoryCreate = async (
  dependencies: JobTitleHistoriesDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<JobTitleHistoryDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createJobTitleHistory(
    toJobTitleHistoriesContext(dependencies, identity),
    toCreateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toJobTitleHistoryDetailData)
  context.set.status = outcome.status
  return outcome.body
}
