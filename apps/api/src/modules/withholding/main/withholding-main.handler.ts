/** 扣繳設定的端點 handler（§1.8.0）。形狀比照 `employments-main.handler.ts`，不重述。 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { WithholdingMainContext } from './domain/withholding-context.ts'
import type {
  CreateWithholdingSettingInput,
  WithholdingMethodCodeValue,
  WithholdingSettingDetail,
  WithholdingSettingListPage,
} from './domain/withholding-model.ts'
import { createWithholdingSetting, listWithholdingSettings } from './withholding-main.service.ts'

export type WithholdingMainDependencies = Omit<WithholdingMainContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('扣繳端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toWithholdingContext = (
  dependencies: WithholdingMainDependencies,
  identity: VerifiedIdentity,
): WithholdingMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toDetailData = (setting: WithholdingSettingDetail) => ({
  id: setting.id,
  employeeId: setting.employeeId,
  withholdingMethodCode: setting.withholdingMethodCode,
  effectiveFrom: setting.effectiveFrom,
  effectiveTo: setting.effectiveTo,
  createdAt: setting.createdAt,
  updatedAt: setting.updatedAt,
})

type CreateBody = {
  readonly employeeId: string
  readonly withholdingMethodCode: WithholdingMethodCodeValue
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

type ListBody = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

const toCreateInput = (body: CreateBody): CreateWithholdingSettingInput => ({
  employeeId: body.employeeId,
  withholdingMethodCode: body.withholdingMethodCode,
  effectiveFrom: body.effectiveFrom,
  effectiveTo: body.effectiveTo ?? null,
})

const toListData = (body: ListBody, page: WithholdingSettingListPage) =>
  toListView(
    { employeeId: body.employeeId },
    { field: 'effectiveFrom', order: 'asc' as const },
    { currentPage: body.currentPage, perPage: body.perPage, totalCount: page.totalCount },
    page.items.map(toDetailData),
  )

export type WithholdingDetailData = ReturnType<typeof toDetailData>
export type WithholdingListData = ReturnType<typeof toListData>

export const handleWithholdingCreate = async (
  dependencies: WithholdingMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<WithholdingDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createWithholdingSetting(
    toWithholdingContext(dependencies, identity),
    toCreateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleWithholdingList = async (
  dependencies: WithholdingMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<WithholdingListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await listWithholdingSettings(toWithholdingContext(dependencies, identity), {
    employeeId: context.body.employeeId,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
  })
  const outcome = resolveServiceResult(result, (page) => toListData(context.body, page))
  context.set.status = outcome.status
  return outcome.body
}
