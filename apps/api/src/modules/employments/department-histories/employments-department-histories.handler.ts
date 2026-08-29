/**
 * 部門歷史的端點 handler（§1.8.0）。**`list` 與 `create` 兩支**：UI 定案 §3.3「可以修改部門、
 * 職稱及一個或多個職務」需要一支真正的建立端點，形狀比照 `job-title-histories` 的同名 handler
 * （該檔頭說明了為何本輪要補上 `create`）。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { DepartmentHistoriesContext } from './domain/department-history-context.ts'
import type {
  CreateDepartmentHistoryInput,
  DepartmentHistoryDetail,
  DepartmentHistoryListPage,
} from './domain/department-history-model.ts'
import { createDepartmentHistory, listDepartmentHistories } from './employments-department-histories.service.ts'

export type DepartmentHistoriesDependencies = Omit<DepartmentHistoriesContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('部門歷史端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toDepartmentHistoriesContext = (
  dependencies: DepartmentHistoriesDependencies,
  identity: VerifiedIdentity,
): DepartmentHistoriesContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toDepartmentHistoryDetailData = (history: DepartmentHistoryDetail) => ({
  id: history.id,
  employmentId: history.employmentId,
  departmentId: history.departmentId,
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
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

const toCreateInput = (body: CreateBody): CreateDepartmentHistoryInput => ({
  employmentId: body.employmentId,
  departmentId: body.departmentId,
  effectiveFrom: body.effectiveFrom,
  effectiveTo: body.effectiveTo ?? null,
})

const toListData = (body: ListBody, page: DepartmentHistoryListPage) =>
  toListView(
    { employmentId: body.employmentId },
    { field: 'effectiveFrom', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toDepartmentHistoryDetailData),
  )

export type DepartmentHistoryListData = ReturnType<typeof toListData>
export type DepartmentHistoryDetailData = ReturnType<typeof toDepartmentHistoryDetailData>

export const handleDepartmentHistoryList = async (
  dependencies: DepartmentHistoriesDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<DepartmentHistoryListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listDepartmentHistories(toDepartmentHistoriesContext(dependencies, identity), {
    employmentId: context.body.employmentId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleDepartmentHistoryCreate = async (
  dependencies: DepartmentHistoriesDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<DepartmentHistoryDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createDepartmentHistory(
    toDepartmentHistoriesContext(dependencies, identity),
    toCreateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toDepartmentHistoryDetailData)
  context.set.status = outcome.status
  return outcome.body
}
