/**
 * 出勤判定結果的端點 handler（§1.8.0 的④與⑥）。形狀比照 `attendance/records/
 * attendance-records.handler.ts`：取出驗證後的 body → 呼叫 service → 把結果收成本端點的
 * `data` 形狀。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`**（§1.8.2）。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { AttendanceResultsContext } from './domain/attendance-result-context.ts'
import type {
  AttendanceResultListCore,
  AttendanceResultListItem,
  ListAttendanceResultsQuery,
  ListOwnAttendanceResultsQuery,
  OwnAttendanceResultListItem,
} from './domain/attendance-result-list-view.ts'
import {
  listAttendanceResults,
  listOwnAttendanceResults,
  recalculateAllNoScheduleAttendanceResults,
} from './attendance-results.service.ts'

/** 由組裝點注入的相依。公司範圍與操作者不在裡面——兩者只能來自每一次請求的已驗證身分（§4.2）。 */
export type AttendanceResultsDependencies = Omit<AttendanceResultsContext, 'companyId' | 'operatorCompanyUserId'>

/** 與 `attendance-records.handler.ts` 相同的結構型別化 context。`TBody` 預設 `unknown` 索引
 * ——`recalculate-no-schedule` 沒有業務欄位、不讀 `body` 的任何屬性，用 `Record<string, never>`
 * 當預設值會讓 Elysia 實際推導出的（含 `rqTS`／`cmd`／`locale` 等基底欄位的）context 型別對不上
 * 而編譯失敗；`list`／`list-own` 各自傳入自己的 body 型別。 */
export type EndpointContext<TBody = Record<string, unknown>> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/** 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）。 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('出勤判定結果端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toAttendanceResultsContext = (
  dependencies: AttendanceResultsDependencies,
  identity: VerifiedIdentity,
): AttendanceResultsContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

const toRecalculateAllNoScheduleData = (result: { readonly recalculatedCount: number }) => ({
  recalculatedCount: result.recalculatedCount,
})

export type RecalculateAllNoScheduleData = ReturnType<typeof toRecalculateAllNoScheduleData>

export const handleRecalculateAllNoScheduleAttendanceResults = async (
  dependencies: AttendanceResultsDependencies,
  context: EndpointContext,
): Promise<EndpointResult<RecalculateAllNoScheduleData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await recalculateAllNoScheduleAttendanceResults(toAttendanceResultsContext(dependencies, identity))
  const outcome = resolveServiceResult(result, toRecalculateAllNoScheduleData)
  context.set.status = outcome.status
  return outcome.body
}

/**
 * 兩支列表端點共用的單筆映射：出勤事實的核心欄位（不含員工／部門）。`list`／`list-own` 各自的
 * 映射函式在這之上疊加自己需要的欄位（見下方），呼應計畫 §5 Stage 7「共用同一份 domain 組裝
 * 函式」——這裡是那份共用組裝在 handler 層的對應動作：組裝在 domain，映射到 API 欄位在 handler，
 * 兩層各自只做一次，不是兩層各自重複組裝一次。
 */
const toAttendanceResultCoreData = (item: AttendanceResultListCore) => ({
  id: item.id,
  workDate: item.workDate,
  clockInAt: item.clockInAt,
  clockInAddress: item.clockInAddress,
  clockOutAt: item.clockOutAt,
  clockOutAddress: item.clockOutAddress,
  workedMinutes: item.workedMinutes,
  lateMinutes: item.lateMinutes,
  earlyLeaveMinutes: item.earlyLeaveMinutes,
  absenceMinutes: item.absenceMinutes,
  sourceTypeCode: item.sourceTypeCode,
  // `[...item.statuses]`：domain 的 `statuses` 是 `readonly Flag[]`，回應 schema（`t.Array`）的
  // Static 型別是可變陣列——`readonly T[]` 不能隱式指派給 `T[]`，這裡明確複製一份可變陣列。
  statuses: [...item.statuses],
})

/** `list` 單筆映射：核心欄位＋員工與「該日有效部門」。 */
const toAttendanceResultListItemData = (item: AttendanceResultListItem) => ({
  ...toAttendanceResultCoreData(item),
  employeeId: item.employeeId,
  employeeCode: item.employeeCode,
  employeeName: item.employeeName,
  departmentName: item.departmentName,
})

/** `list-own` 單筆映射：僅核心欄位——查的必然是自己，不需要員工／部門欄位。 */
const toOwnAttendanceResultListItemData = (item: OwnAttendanceResultListItem) => toAttendanceResultCoreData(item)

export type AttendanceResultListItemData = ReturnType<typeof toAttendanceResultListItemData>
export type OwnAttendanceResultListItemData = ReturnType<typeof toOwnAttendanceResultListItemData>

type ListBody = {
  readonly yearMonth: string
  readonly departmentId?: string
  readonly employeeId?: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: 'workDate' | 'employeeCode'; readonly order: 'asc' | 'desc' }
}

/** `list-own` 的 body：**沒有 `employeeId`／`departmentId`**——範圍固定是呼叫者本人，不接受呼叫端
 * 指定要查誰（計畫「body 不得接受 employeeId」，比照 `attendance/records` 的 `list-own-by-date`）。 */
type ListOwnBody = {
  readonly yearMonth: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: 'workDate'; readonly order: 'asc' | 'desc' }
}

/** `list` 未帶 `sort` 時的預設值：依日期新到舊（比照 UI 12「日期預設由新到舊排列」）。 */
const DEFAULT_LIST_SORT = { field: 'workDate', order: 'desc' } as const

/** `list-own` 未帶 `sort` 時的預設值：UI 12 明文「日期預設由新到舊排列」。 */
const DEFAULT_LIST_OWN_SORT = { field: 'workDate', order: 'desc' } as const

/** 搜尋條件回聲（§1.4：使用者沒送的條件就不出現），條件展開理由與 `attendance-records.
 * handler.ts` 的 `toListByDateSearchEcho` 相同。 */
const toListSearchEcho = (body: ListBody) => ({
  yearMonth: body.yearMonth,
  ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
  ...(body.employeeId === undefined ? {} : { employeeId: body.employeeId }),
})

export const handleAttendanceResultsList = async (
  dependencies: AttendanceResultsDependencies,
  context: EndpointContext<ListBody>,
): Promise<
  EndpointResult<ReturnType<typeof toListView<ReturnType<typeof toListSearchEcho>, AttendanceResultListItemData>>>
> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ListAttendanceResultsQuery = {
    yearMonth: context.body.yearMonth,
    departmentId: context.body.departmentId ?? null,
    employeeId: context.body.employeeId ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: context.body.sort ?? DEFAULT_LIST_SORT,
  }

  const result = await listAttendanceResults(toAttendanceResultsContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) =>
    toListView(
      toListSearchEcho(context.body),
      query.sort,
      { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
      page.items.map(toAttendanceResultListItemData),
    ),
  )
  context.set.status = outcome.status
  return outcome.body
}

/** `list-own` 的搜尋條件回聲：只有 `yearMonth`，範圍固定是本人，沒有可篩選的欄位。 */
const toListOwnSearchEcho = (body: ListOwnBody) => ({ yearMonth: body.yearMonth })

export const handleAttendanceResultsListOwn = async (
  dependencies: AttendanceResultsDependencies,
  context: EndpointContext<ListOwnBody>,
): Promise<
  EndpointResult<ReturnType<typeof toListView<ReturnType<typeof toListOwnSearchEcho>, OwnAttendanceResultListItemData>>>
> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ListOwnAttendanceResultsQuery = {
    yearMonth: context.body.yearMonth,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: context.body.sort ?? DEFAULT_LIST_OWN_SORT,
  }

  const result = await listOwnAttendanceResults(toAttendanceResultsContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) =>
    toListView(
      toListOwnSearchEcho(context.body),
      query.sort,
      { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
      page.items.map(toOwnAttendanceResultListItemData),
    ),
  )
  context.set.status = outcome.status
  return outcome.body
}
