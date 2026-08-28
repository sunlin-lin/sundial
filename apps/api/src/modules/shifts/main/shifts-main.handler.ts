/**
 * 班別主檔的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 *
 * **`isOvernight`／`requiredWorkMinutes`／`workMinutes`／`breakMinutes` 只出現在這一層的輸出
 * 映射裡，從來沒有出現在任何一個輸入型別上**（計畫 §4.1）：body 型別裡根本沒有這幾個欄位，
 * 因此「前端送了一個跟算出來的不一樣的值」這種情況在型別上就寫不出來。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { ShiftsMainContext } from './domain/shift-context.ts'
import { resolveShiftSort } from './domain/shift-list-view.ts'
import type {
  ShiftBreak,
  ShiftBreakInput,
  ShiftDetail,
  ShiftListPage,
  ShiftListQuery,
  ShiftSummary,
  ShiftWorkPeriod,
  ShiftWorkPeriodInput,
  ShiftWorkTypeValue,
} from './domain/shift-model.ts'
import { copyShift, createShift, deleteShift, getShift, listShifts, updateShift } from './shifts-main.service.ts'

/** 由組裝點注入的相依。公司範圍不在裡面——它只能來自每一次請求的已驗證身分（§4.2）。 */
export type ShiftsMainDependencies = Omit<ShiftsMainContext, 'companyId'>

/** 與 `employees-main.handler.ts` 相同的結構型別化 context，理由見該檔說明。 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）
 * ——理由與 `employees-main.handler.ts` 的同名函式相同。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('班別端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toShiftContext = (dependencies: ShiftsMainDependencies, identity: VerifiedIdentity): ShiftsMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
})

const toShiftWorkPeriodData = (period: ShiftWorkPeriod) => ({
  sequenceNo: period.sequenceNo,
  startTime: period.startTime,
  endTime: period.endTime,
  endDayOffset: period.endDayOffset,
  workMinutes: period.workMinutes,
})

const toShiftBreakData = (entry: ShiftBreak) => ({
  sequenceNo: entry.sequenceNo,
  startTime: entry.startTime,
  endTime: entry.endTime,
  startDayOffset: entry.startDayOffset,
  endDayOffset: entry.endDayOffset,
  breakMinutes: entry.breakMinutes,
  isPaid: entry.isPaid,
})

/**
 * 業務資料 → 本端點的 `data`。**必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的
 * 回傳值指派給 `data`，資料表加一個欄位就會自動出現在 API 上。
 */
const toShiftSummaryData = (shift: ShiftSummary) => ({
  id: shift.id,
  code: shift.code,
  name: shift.name,
  workTypeCode: shift.workTypeCode,
  isOvernight: shift.isOvernight,
  isFlexible: shift.isFlexible,
  requiredWorkMinutes: shift.requiredWorkMinutes,
  isActive: shift.isActive,
  workPeriods: shift.workPeriods.map(toShiftWorkPeriodData),
  breaks: shift.breaks.map(toShiftBreakData),
})

const toShiftDetailData = (shift: ShiftDetail) => ({
  ...toShiftSummaryData(shift),
  description: shift.description,
  createdAt: shift.createdAt,
  updatedAt: shift.updatedAt,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableShiftDetailData = (shift: ShiftDetail | null) => (shift === null ? null : toShiftDetailData(shift))

type WorkPeriodInputBody = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly endDayOffset: number
}

type BreakInputBody = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly startDayOffset: number
  readonly endDayOffset: number
  readonly isPaid: boolean
}

type ListBody = {
  readonly keyword?: string
  readonly workTypeCode?: ShiftWorkTypeValue
  readonly isOvernight?: boolean
  readonly isFlexible?: boolean
  readonly isActive?: boolean
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: string; readonly order: 'asc' | 'desc' }
}

type TargetBody = { readonly id: string }

type ProfileBody = {
  readonly code: string
  readonly name: string
  readonly workTypeCode: ShiftWorkTypeValue
  readonly isFlexible: boolean
  readonly description: string
  readonly isActive: boolean
  readonly workPeriods: readonly WorkPeriodInputBody[]
  readonly breaks: readonly BreakInputBody[]
}

type UpdateBody = TargetBody & ProfileBody

type CopyBody = {
  readonly sourceId: string
  readonly code: string
  readonly name: string
  readonly description: string
  readonly isActive: boolean
}

/** 搜尋條件的回聲（§1.4）。只放使用者真的送來的條件，理由見 `employees-main.handler.ts` 同名函式。 */
const toSearchEcho = (body: ListBody) => ({
  ...(body.keyword === undefined ? {} : { keyword: body.keyword }),
  ...(body.workTypeCode === undefined ? {} : { workTypeCode: body.workTypeCode }),
  ...(body.isOvernight === undefined ? {} : { isOvernight: body.isOvernight }),
  ...(body.isFlexible === undefined ? {} : { isFlexible: body.isFlexible }),
  ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
})

const toWorkPeriodInput = (period: WorkPeriodInputBody): ShiftWorkPeriodInput => ({
  sequenceNo: period.sequenceNo,
  startTime: period.startTime,
  endTime: period.endTime,
  endDayOffset: period.endDayOffset,
})

const toBreakInput = (entry: BreakInputBody): ShiftBreakInput => ({
  sequenceNo: entry.sequenceNo,
  startTime: entry.startTime,
  endTime: entry.endTime,
  startDayOffset: entry.startDayOffset,
  endDayOffset: entry.endDayOffset,
  isPaid: entry.isPaid,
})

const toProfileInput = (body: ProfileBody) => ({
  code: body.code,
  name: body.name,
  workTypeCode: body.workTypeCode,
  isFlexible: body.isFlexible,
  description: body.description,
  isActive: body.isActive,
  workPeriods: body.workPeriods.map(toWorkPeriodInput),
  breaks: body.breaks.map(toBreakInput),
})

const toShiftListData = (query: ShiftListQuery, body: ListBody, page: ShiftListPage) =>
  // `search` 與 `sort` 由**共用的** list 組裝函式帶回（§1.8.1），不讓端點自己填。
  toListView(
    toSearchEcho(body),
    query.sort,
    { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
    page.items.map(toShiftSummaryData),
  )

/** 各端點 `data` 的型別。由映射函式反推，因此改了映射就會改型別，不會兩邊漂移。 */
export type ShiftDetailData = ReturnType<typeof toShiftDetailData>
export type ShiftListData = ReturnType<typeof toShiftListData>
export type DeletedShiftData = { readonly id: string }

export const handleShiftList = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<ShiftListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ShiftListQuery = {
    keyword: context.body.keyword ?? null,
    workTypeCode: context.body.workTypeCode ?? null,
    isOvernight: context.body.isOvernight ?? null,
    isFlexible: context.body.isFlexible ?? null,
    // **預設顯示啟用班別**（UI 定案，`docs/ui/22-ui-shift-settings.md`）：使用者沒有明確篩選
    // 狀態時，補上 `true` 而不是 `null`（不篩選）。這個決定放在 handler 而不是 repository，
    // 理由與排序的預設值相同（`resolveShiftSort`）：回聲的必須是「實際生效的條件」。
    isActive: context.body.isActive ?? true,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: resolveShiftSort(context.body.sort),
  }

  const result = await listShifts(toShiftContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toShiftListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleShiftGet = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<ShiftDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getShift(toShiftContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableShiftDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleShiftCreate = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<ProfileBody>,
): Promise<EndpointResult<ShiftDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createShift(toShiftContext(dependencies, identity), toProfileInput(context.body))
  const outcome = resolveServiceResult(result, toShiftDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleShiftUpdate = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<ShiftDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateShift(toShiftContext(dependencies, identity), {
    id: context.body.id,
    ...toProfileInput(context.body),
  })
  const outcome = resolveServiceResult(result, toShiftDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleShiftCopy = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<CopyBody>,
): Promise<EndpointResult<ShiftDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await copyShift(toShiftContext(dependencies, identity), {
    sourceId: context.body.sourceId,
    code: context.body.code,
    name: context.body.name,
    description: context.body.description,
    isActive: context.body.isActive,
  })
  const outcome = resolveServiceResult(result, toShiftDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleShiftDelete = async (
  dependencies: ShiftsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedShiftData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteShift(toShiftContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}
