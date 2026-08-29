/**
 * 打卡的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 *
 * ## `get` 的座標可見範圍：鍵存不存在由這裡決定，不是 service
 *
 * `getAttendanceRecord` 回的 `coordinates` 是一個 `{ visible: true/false }` 的業務決定
 * （`impl/attendance-records.get.service.ts`）；把它翻成「回應物件裡有沒有 `latitude`／
 * `longitude` 這兩把鍵」是這裡的事——`toAttendanceRecordGetDetailData` 用條件展開
 * （`...(visible ? { latitude, longitude } : {})`）而不是把值設成 `undefined`：後者在 JSON
 * 序列化後與「完全沒有這個鍵」看起來一樣，但兩者在型別上與測試斷言上必須是可分辨的兩件事
 * （計畫 §4.2、`domain/attendance-record-visibility.ts` 檔頭）。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { AttendanceTypeCodeValue } from '../../../db/schema/index.ts'
import type { AttendanceRecordsContext } from './domain/attendance-record-context.ts'
import type {
  AttendanceRecordDetail,
  AttendanceRecordListItem,
  ListAttendanceRecordsByDateQuery,
  ListOwnAttendanceRecordsByDateQuery,
  OwnAttendanceRecordListItem,
} from './domain/attendance-record-model.ts'
import type { AttendanceRecordView } from './impl/attendance-records.get.service.ts'
import {
  createAttendanceRecord,
  getAttendanceRecord,
  listAttendanceRecordsByDate,
  listOwnAttendanceRecordsByDate,
  revokeOtherAttendanceRecord,
  revokeOwnAttendanceRecord,
} from './attendance-records.service.ts'
import { toListView } from '../../../shared/list-view.ts'

/** 由組裝點注入的相依。公司範圍與操作者不在裡面——兩者只能來自每一次請求的已驗證身分（§4.2）。 */
export type AttendanceRecordsDependencies = Omit<AttendanceRecordsContext, 'companyId' | 'operatorCompanyUserId'>

/** 與 `attendance-settings.handler.ts` 相同的結構型別化 context。 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/** 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）。 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('打卡端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toAttendanceRecordsContext = (
  dependencies: AttendanceRecordsDependencies,
  identity: VerifiedIdentity,
): AttendanceRecordsContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

/**
 * `create`／`revoke`／`revoke-other` 共用的映射：這三支端點的回應**恆含座標**（不套用 `get` 的
 * 可見範圍分支）——`create`／`revoke` 回的必然是呼叫者自己的打卡，`revoke-other` 的端點本身已經
 * 要求 `attendance.records.revoke-other` 權限碼才進得來，兩種情況都落在計畫 §4.2「有權限看」的
 * 分支，因此不需要在這裡重複判斷一次。
 */
const toAttendanceRecordDetailData = (detail: AttendanceRecordDetail) => ({
  id: detail.id,
  employeeId: detail.employeeId,
  employmentId: detail.employmentId,
  workDate: detail.workDate,
  attendanceTypeCode: detail.attendanceTypeCode,
  sourceTypeCode: detail.sourceTypeCode,
  clockedAt: detail.clockedAt,
  latitude: detail.latitude,
  longitude: detail.longitude,
  accuracyMeters: detail.accuracyMeters,
  address: detail.address,
  revokedAt: detail.revokedAt,
  revokedBy: detail.revokedBy,
  revokedByName: detail.revokedByName,
  revokeReason: detail.revokeReason,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
})

/**
 * `get` 專用映射：`latitude`／`longitude` 兩把鍵依 `view.coordinates.visible` 決定要不要出現
 * ——見檔頭。**三種情境的測試都要斷言鍵存不存在，見 `__tests__/attendance-records.endpoints.
 * test.ts`。**
 */
const toAttendanceRecordGetDetailData = (view: AttendanceRecordView) => {
  const { detail, coordinates } = view
  return {
    id: detail.id,
    employeeId: detail.employeeId,
    employmentId: detail.employmentId,
    workDate: detail.workDate,
    attendanceTypeCode: detail.attendanceTypeCode,
    sourceTypeCode: detail.sourceTypeCode,
    clockedAt: detail.clockedAt,
    ...(coordinates.visible ? { latitude: coordinates.latitude, longitude: coordinates.longitude } : {}),
    accuracyMeters: detail.accuracyMeters,
    address: detail.address,
    revokedAt: detail.revokedAt,
    revokedBy: detail.revokedBy,
    revokedByName: detail.revokedByName,
    revokeReason: detail.revokeReason,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  }
}

const toNullableAttendanceRecordGetDetailData = (view: AttendanceRecordView | null) =>
  view === null ? null : toAttendanceRecordGetDetailData(view)

const toAttendanceRecordListItemData = (item: AttendanceRecordListItem) => ({
  id: item.id,
  employeeId: item.employeeId,
  employeeCode: item.employeeCode,
  employeeName: item.employeeName,
  departmentName: item.departmentName,
  employmentId: item.employmentId,
  workDate: item.workDate,
  attendanceTypeCode: item.attendanceTypeCode,
  sourceTypeCode: item.sourceTypeCode,
  clockedAt: item.clockedAt,
  address: item.address,
  revokedAt: item.revokedAt,
  revokedBy: item.revokedBy,
  revokeReason: item.revokeReason,
})

/**
 * `list-own-by-date` 單筆映射。**恆不含座標**——與 `toAttendanceRecordListItemData` 同一條規則
 * （計畫 §4.2：列表一律不回座標），差別只在少了 `employeeCode`／`employeeName`／`departmentName`
 * 三欄（查自己不需要回聲自己的姓名工號），見 `domain/attendance-record-model.ts` 的
 * `OwnAttendanceRecordListItem` 檔頭。
 */
const toOwnAttendanceRecordListItemData = (item: OwnAttendanceRecordListItem) => ({
  id: item.id,
  employmentId: item.employmentId,
  workDate: item.workDate,
  attendanceTypeCode: item.attendanceTypeCode,
  sourceTypeCode: item.sourceTypeCode,
  clockedAt: item.clockedAt,
  address: item.address,
  revokedAt: item.revokedAt,
  revokedBy: item.revokedBy,
  revokeReason: item.revokeReason,
})

/** 各端點 `data` 的型別。由映射函式反推，因此改了映射就會改型別，不會兩邊漂移。 */
export type AttendanceRecordDetailData = ReturnType<typeof toAttendanceRecordDetailData>
export type AttendanceRecordGetDetailData = ReturnType<typeof toAttendanceRecordGetDetailData>
export type AttendanceRecordListData = ReturnType<typeof toAttendanceRecordListItemData>
export type OwnAttendanceRecordListData = ReturnType<typeof toOwnAttendanceRecordListItemData>

type CreateBody = {
  readonly attendanceTypeCode: AttendanceTypeCodeValue
  readonly latitude?: number | null
  readonly longitude?: number | null
  readonly accuracyMeters?: number | null
}

type RevokeBody = { readonly recordId: string; readonly reason: string }
type RevokeOtherBody = { readonly recordId: string; readonly reason: string }
type GetBody = { readonly recordId: string }

type ListByDateBody = {
  readonly date: string
  readonly departmentId?: string
  readonly employeeId?: string
  /** 全部／只看有效／只看已撤銷（UI 23）。未帶時 handler 補上 `'all'`。 */
  readonly status?: 'all' | 'active' | 'revoked'
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: 'employeeCode' | 'clockedAt'; readonly order: 'asc' | 'desc' }
}

/** `list-own-by-date` 的 body：**沒有 `employeeId`／`departmentId`**——範圍固定是呼叫者本人，
 * 不接受呼叫端指定要查誰（§4.2 的細粒度範圍規則，比照 `RevokeBody` 不接受 `employeeId`）。 */
type ListOwnByDateBody = {
  readonly date: string
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: 'clockedAt'; readonly order: 'asc' | 'desc' }
}

/** `list-by-date` 未帶 `sort` 時的預設值（UI 23 定案）：先依員工工號，同一員工再依打卡時間。 */
const DEFAULT_LIST_BY_DATE_SORT = { field: 'employeeCode', order: 'asc' } as const

/** `list-own-by-date` 未帶 `sort` 時的預設值——範圍固定是本人，沒有「先依員工分組」的需求。 */
const DEFAULT_LIST_OWN_BY_DATE_SORT = { field: 'clockedAt', order: 'asc' } as const

export const handleAttendanceRecordCreate = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<AttendanceRecordDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createAttendanceRecord(toAttendanceRecordsContext(dependencies, identity), {
    attendanceTypeCode: context.body.attendanceTypeCode,
    latitude: context.body.latitude ?? null,
    longitude: context.body.longitude ?? null,
    accuracyMeters: context.body.accuracyMeters ?? null,
  })
  const outcome = resolveServiceResult(result, toAttendanceRecordDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleAttendanceRecordRevoke = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<RevokeBody>,
): Promise<EndpointResult<AttendanceRecordDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await revokeOwnAttendanceRecord(toAttendanceRecordsContext(dependencies, identity), {
    recordId: context.body.recordId,
    reason: context.body.reason,
  })
  const outcome = resolveServiceResult(result, toAttendanceRecordDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleAttendanceRecordRevokeOther = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<RevokeOtherBody>,
): Promise<EndpointResult<AttendanceRecordDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await revokeOtherAttendanceRecord(toAttendanceRecordsContext(dependencies, identity), {
    recordId: context.body.recordId,
    reason: context.body.reason,
  })
  const outcome = resolveServiceResult(result, toAttendanceRecordDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleAttendanceRecordGet = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<GetBody>,
): Promise<EndpointResult<AttendanceRecordGetDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getAttendanceRecord(toAttendanceRecordsContext(dependencies, identity), {
    recordId: context.body.recordId,
  })
  const outcome = resolveServiceResult(result, toNullableAttendanceRecordGetDetailData)
  context.set.status = outcome.status
  return outcome.body
}

/**
 * 搜尋條件回聲（§1.4：使用者沒送的條件就不出現）。**條件展開而不是直寫**——
 * `exactOptionalPropertyTypes` 之下，「沒有這個欄位」與「欄位是 `undefined`」是兩件事，
 * 直寫 `departmentId: context.body.departmentId` 在沒送這個條件時會把值寫成 `undefined`，
 * 而不是讓這把鍵整個消失，形狀比照 `employees-main.handler.ts` 的 `toSearchEcho`。
 */
const toListByDateSearchEcho = (body: ListByDateBody) => ({
  date: body.date,
  ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
  ...(body.employeeId === undefined ? {} : { employeeId: body.employeeId }),
  // `status` 一律回聲解析後的值（比照 `date`），不像 departmentId／employeeId 用條件展開——
  // 這一欄永遠有一個生效值（未帶時等同 'all'），沒有「沒篩選」與「篩了但送 undefined」的分別。
  status: body.status ?? 'all',
})

export const handleAttendanceRecordListByDate = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<ListByDateBody>,
): Promise<
  EndpointResult<ReturnType<typeof toListView<ReturnType<typeof toListByDateSearchEcho>, AttendanceRecordListData>>>
> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ListAttendanceRecordsByDateQuery = {
    workDate: context.body.date,
    departmentId: context.body.departmentId ?? null,
    employeeId: context.body.employeeId ?? null,
    status: context.body.status ?? 'all',
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: context.body.sort ?? DEFAULT_LIST_BY_DATE_SORT,
  }

  const result = await listAttendanceRecordsByDate(toAttendanceRecordsContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) =>
    toListView(
      toListByDateSearchEcho(context.body),
      query.sort,
      { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
      page.items.map(toAttendanceRecordListItemData),
    ),
  )
  context.set.status = outcome.status
  return outcome.body
}

/** `list-own-by-date` 的搜尋條件回聲：只有 `date`，範圍固定是本人，沒有可篩選的欄位。 */
const toListOwnByDateSearchEcho = (body: ListOwnByDateBody) => ({ date: body.date })

export const handleAttendanceRecordListOwnByDate = async (
  dependencies: AttendanceRecordsDependencies,
  context: EndpointContext<ListOwnByDateBody>,
): Promise<
  EndpointResult<
    ReturnType<typeof toListView<ReturnType<typeof toListOwnByDateSearchEcho>, OwnAttendanceRecordListData>>
  >
> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: ListOwnAttendanceRecordsByDateQuery = {
    workDate: context.body.date,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    sort: context.body.sort ?? DEFAULT_LIST_OWN_BY_DATE_SORT,
  }

  const result = await listOwnAttendanceRecordsByDate(toAttendanceRecordsContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) =>
    toListView(
      toListOwnByDateSearchEcho(context.body),
      query.sort,
      { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
      page.items.map(toOwnAttendanceRecordListItemData),
    ),
  )
  context.set.status = outcome.status
  return outcome.body
}
