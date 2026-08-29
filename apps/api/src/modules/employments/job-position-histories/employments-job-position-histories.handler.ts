/** 職務歷史的端點 handler（§1.8.0）。`create` 一次收多個 `jobPositionIds`（見 domain model 檔頭）。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { JobPositionHistoriesContext } from './domain/job-position-history-context.ts'
import type {
  CreateJobPositionHistoriesInput,
  JobPositionHistoryDetail,
  JobPositionHistoryListPage,
} from './domain/job-position-history-model.ts'
import { createJobPositionHistories, listJobPositionHistories } from './employments-job-position-histories.service.ts'

export type JobPositionHistoriesDependencies = Omit<JobPositionHistoriesContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('職務歷史端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toJobPositionHistoriesContext = (
  dependencies: JobPositionHistoriesDependencies,
  identity: VerifiedIdentity,
): JobPositionHistoriesContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toJobPositionHistoryDetailData = (history: JobPositionHistoryDetail) => ({
  id: history.id,
  employmentId: history.employmentId,
  jobPositionId: history.jobPositionId,
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
  readonly jobPositionIds: readonly string[]
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

const toCreateInput = (body: CreateBody): CreateJobPositionHistoriesInput => ({
  employmentId: body.employmentId,
  jobPositionIds: body.jobPositionIds,
  effectiveFrom: body.effectiveFrom,
  effectiveTo: body.effectiveTo ?? null,
})

const toListData = (body: ListBody, page: JobPositionHistoryListPage) =>
  toListView(
    { employmentId: body.employmentId },
    { field: 'effectiveFrom', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toJobPositionHistoryDetailData),
  )

/** `create` 的 `data`：一次可能建立多筆，包成 `{ items }`（比照 `company-users/roles` 的 `SnapshotData`）。 */
const toJobPositionHistoryCreateData = (histories: readonly JobPositionHistoryDetail[]) => ({
  items: histories.map(toJobPositionHistoryDetailData),
})

export type JobPositionHistoryDetailData = ReturnType<typeof toJobPositionHistoryDetailData>
export type JobPositionHistoryListData = ReturnType<typeof toListData>
export type JobPositionHistoryCreateData = ReturnType<typeof toJobPositionHistoryCreateData>

export const handleJobPositionHistoryList = async (
  dependencies: JobPositionHistoriesDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<JobPositionHistoryListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listJobPositionHistories(toJobPositionHistoriesContext(dependencies, identity), {
    employmentId: context.body.employmentId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleJobPositionHistoryCreate = async (
  dependencies: JobPositionHistoriesDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<JobPositionHistoryCreateData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createJobPositionHistories(
    toJobPositionHistoriesContext(dependencies, identity),
    toCreateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toJobPositionHistoryCreateData)
  context.set.status = outcome.status
  return outcome.body
}
