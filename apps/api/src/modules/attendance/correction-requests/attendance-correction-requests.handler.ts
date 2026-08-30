/**
 * 補打卡申請的端點 handler（§1.8.0 的④與⑥）。形狀比照 `attendance/records/
 * attendance-records.handler.ts`：取出驗證後的 body → 呼叫 service → 把結果收成本端點的
 * `data` 形狀。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`**（§1.8.2）。
 *
 * **沒有座標可見範圍那種「依身分決定回不回欄位」的分支**：這三支端點的回應恆是呼叫者自己的申請
 * （`submit`／`withdraw` 建立或撤回的必然是自己那一筆；`listOwn` 範圍固定是本人），不像
 * `attendance/records` 的 `get` 需要依「查的是不是自己」決定要不要隱藏欄位。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { AttendanceTypeCodeValue } from '../../../db/schema/index.ts'
import type { AttendanceCorrectionRequestsContext } from './domain/attendance-correction-request-context.ts'
import type {
  AttendanceCorrectionRequestDetail,
  AttendanceCorrectionRequestListStatus,
  ListOwnAttendanceCorrectionRequestsQuery,
  OwnAttendanceCorrectionRequestListItem,
} from './domain/attendance-correction-request-model.ts'
import {
  listOwnAttendanceCorrectionRequests,
  submitAttendanceCorrectionRequest,
  withdrawAttendanceCorrectionRequest,
} from './attendance-correction-requests.service.ts'

/** 由組裝點注入的相依。公司範圍與操作者不在裡面——兩者只能來自每一次請求的已驗證身分（§4.2）。 */
export type AttendanceCorrectionRequestsDependencies = Omit<
  AttendanceCorrectionRequestsContext,
  'companyId' | 'operatorCompanyUserId'
>

/** 與 `attendance-records.handler.ts` 相同的結構型別化 context。 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/** 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）。 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('補打卡申請端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toAttendanceCorrectionRequestsContext = (
  dependencies: AttendanceCorrectionRequestsDependencies,
  identity: VerifiedIdentity,
): AttendanceCorrectionRequestsContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

/** `submit`／`withdraw` 共用的映射：兩支端點的回應恆是呼叫者自己的申請完整明細。 */
const toAttendanceCorrectionRequestDetailData = (detail: AttendanceCorrectionRequestDetail) => ({
  id: detail.id,
  employeeId: detail.employeeId,
  employmentId: detail.employmentId,
  workDate: detail.workDate,
  attendanceTypeCode: detail.attendanceTypeCode,
  requestedClockedAt: detail.requestedClockedAt,
  reason: detail.reason,
  statusCode: detail.statusCode,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
})

const toOwnAttendanceCorrectionRequestListItemData = (item: OwnAttendanceCorrectionRequestListItem) => ({
  id: item.id,
  workDate: item.workDate,
  attendanceTypeCode: item.attendanceTypeCode,
  requestedClockedAt: item.requestedClockedAt,
  reason: item.reason,
  statusCode: item.statusCode,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
})

/** 各端點 `data` 的型別。由映射函式反推，因此改了映射就會改型別，不會兩邊漂移。 */
export type AttendanceCorrectionRequestDetailData = ReturnType<typeof toAttendanceCorrectionRequestDetailData>
export type OwnAttendanceCorrectionRequestListData = ReturnType<typeof toOwnAttendanceCorrectionRequestListItemData>

type SubmitBody = {
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly workDate: string
  readonly requestedClockedAt: string
  readonly reason: string
}

type WithdrawBody = { readonly requestId: string }

type ListOwnBody = {
  readonly yearMonth: string
  readonly status?: AttendanceCorrectionRequestListStatus
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: 'workDate'; readonly order: 'asc' | 'desc' }
}

/** `list-own` 未帶 `sort` 時的預設值：UI 13「日期預設由新到舊排列」。 */
const DEFAULT_LIST_OWN_SORT = { field: 'workDate', order: 'desc' } as const

export const handleAttendanceCorrectionRequestSubmit = async (
  dependencies: AttendanceCorrectionRequestsDependencies,
  context: EndpointContext<SubmitBody>,
): Promise<EndpointResult<AttendanceCorrectionRequestDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await submitAttendanceCorrectionRequest(
    toAttendanceCorrectionRequestsContext(dependencies, identity),
    {
      attendanceTypeCode: context.body.attendanceTypeCode,
      workDate: context.body.workDate,
      requestedClockedAt: context.body.requestedClockedAt,
      reason: context.body.reason,
    },
  )
  const outcome = resolveServiceResult(result, toAttendanceCorrectionRequestDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleAttendanceCorrectionRequestWithdraw = async (
  dependencies: AttendanceCorrectionRequestsDependencies,
  context: EndpointContext<WithdrawBody>,
): Promise<EndpointResult<AttendanceCorrectionRequestDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await withdrawAttendanceCorrectionRequest(
    toAttendanceCorrectionRequestsContext(dependencies, identity),
    { requestId: context.body.requestId },
  )
  const outcome = resolveServiceResult(result, toAttendanceCorrectionRequestDetailData)
  context.set.status = outcome.status
  return outcome.body
}

/** 搜尋條件回聲（§1.4：使用者沒送的條件就不出現）。`status` 一律回聲解析後的值（未帶時等同
 * `'all'`），比照 `attendance/records` 的 `list-by-date` 對 `status` 的處理——這一欄永遠有一個
 * 生效值，沒有「沒篩選」與「篩了但送 undefined」的分別。 */
const toListOwnSearchEcho = (body: ListOwnBody) => ({ yearMonth: body.yearMonth, status: body.status ?? 'all' })

export const handleAttendanceCorrectionRequestListOwn = async (
  dependencies: AttendanceCorrectionRequestsDependencies,
  context: EndpointContext<ListOwnBody>,
): Promise<
  EndpointResult<
    ReturnType<typeof toListView<ReturnType<typeof toListOwnSearchEcho>, OwnAttendanceCorrectionRequestListData>>
  >
> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ListOwnAttendanceCorrectionRequestsQuery = {
    yearMonth: context.body.yearMonth,
    status: context.body.status ?? 'all',
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: context.body.sort ?? DEFAULT_LIST_OWN_SORT,
  }

  const result = await listOwnAttendanceCorrectionRequests(
    toAttendanceCorrectionRequestsContext(dependencies, identity),
    query,
  )
  const outcome = resolveServiceResult(result, (page) =>
    toListView(
      toListOwnSearchEcho(context.body),
      query.sort,
      { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
      page.items.map(toOwnAttendanceCorrectionRequestListItemData),
    ),
  )
  context.set.status = outcome.status
  return outcome.body
}
