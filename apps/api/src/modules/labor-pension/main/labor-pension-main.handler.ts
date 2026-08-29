/** 勞退設定的端點 handler（§1.8.0）。形狀比照 `withholding-main.handler.ts`，不重述。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { LaborPensionMainContext } from './domain/labor-pension-context.ts'
import type {
  CreateLaborPensionSettingInput,
  LaborPensionSettingDetail,
  LaborPensionSettingListPage,
} from './domain/labor-pension-model.ts'
import { createLaborPensionSetting, listLaborPensionSettings } from './labor-pension-main.service.ts'

export type LaborPensionMainDependencies = Omit<LaborPensionMainContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('勞退設定端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toLaborPensionContext = (
  dependencies: LaborPensionMainDependencies,
  identity: VerifiedIdentity,
): LaborPensionMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toDetailData = (setting: LaborPensionSettingDetail) => ({
  id: setting.id,
  employeeId: setting.employeeId,
  voluntaryContributionRate: setting.voluntaryContributionRate,
  effectiveFrom: setting.effectiveFrom,
  effectiveTo: setting.effectiveTo,
  createdBy: setting.createdBy,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
})

type CreateBody = {
  readonly employeeId: string
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

type ListBody = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

const toCreateInput = (body: CreateBody): CreateLaborPensionSettingInput => ({
  employeeId: body.employeeId,
  voluntaryContributionRate: body.voluntaryContributionRate,
  effectiveFrom: body.effectiveFrom,
  effectiveTo: body.effectiveTo ?? null,
})

const toListData = (body: ListBody, page: LaborPensionSettingListPage) =>
  toListView(
    { employeeId: body.employeeId },
    { field: 'effectiveFrom', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toDetailData),
  )

export type LaborPensionDetailData = ReturnType<typeof toDetailData>
export type LaborPensionListData = ReturnType<typeof toListData>

export const handleLaborPensionCreate = async (
  dependencies: LaborPensionMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<LaborPensionDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createLaborPensionSetting(
    toLaborPensionContext(dependencies, identity),
    toCreateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleLaborPensionList = async (
  dependencies: LaborPensionMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<LaborPensionListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listLaborPensionSettings(toLaborPensionContext(dependencies, identity), {
    employeeId: context.body.employeeId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}
