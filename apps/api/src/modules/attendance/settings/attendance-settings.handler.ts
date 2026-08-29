/**
 * 出勤設定的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { AttendanceSettingsContext } from './domain/attendance-settings-context.ts'
import type { AttendanceSettingsDetail, UpdateAttendanceSettingsInput } from './domain/attendance-settings-model.ts'
import { getAttendanceSettings, upsertAttendanceSettings } from './attendance-settings.service.ts'

/** 由組裝點注入的相依。公司範圍與操作者不在裡面——兩者只能來自每一次請求的已驗證身分（§4.2）。 */
export type AttendanceSettingsDependencies = Omit<AttendanceSettingsContext, 'companyId' | 'operatorCompanyUserId'>

/** 與 `departments-main.handler.ts`／`labor-pension-main.handler.ts` 相同的結構型別化 context。 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('出勤設定端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toAttendanceSettingsContext = (
  dependencies: AttendanceSettingsDependencies,
  identity: VerifiedIdentity,
): AttendanceSettingsContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

/**
 * 業務資料 → 本端點的 `data`。**必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的
 * 回傳值指派給 `data`，資料表加一個欄位就會自動出現在 API 上。
 */
const toAttendanceSettingsDetailData = (settings: AttendanceSettingsDetail) => ({
  id: settings.id,
  requireClockInBeforeClockOut: settings.requireClockInBeforeClockOut,
  allowEmployeeCancellation: settings.allowEmployeeCancellation,
  allowCorrectionRequest: settings.allowCorrectionRequest,
  correctionRequiresApproval: settings.correctionRequiresApproval,
  gpsEnabled: settings.gpsEnabled,
  gpsRequired: settings.gpsRequired,
  createdAt: settings.createdAt,
  updatedAt: settings.updatedAt,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableAttendanceSettingsDetailData = (settings: AttendanceSettingsDetail | null) =>
  settings === null ? null : toAttendanceSettingsDetailData(settings)

/**
 * `get` 沒有任何業務欄位——只有基底三欄（比照 `departments-main.routes.ts` 的 `tree`）：
 * 這張表一間公司一筆，查詢範圍完全由已驗證身分的公司範圍決定，不需要呼叫端指定任何識別碼。
 */
type GetBody = {
  readonly rqTS: string
  readonly cmd: string
  readonly locale: string
}

type UpdateBody = {
  readonly requireClockInBeforeClockOut: boolean
  readonly allowEmployeeCancellation: boolean
  readonly allowCorrectionRequest: boolean
  readonly correctionRequiresApproval: boolean
  readonly gpsEnabled: boolean
  readonly gpsRequired: boolean
}

const toUpdateInput = (body: UpdateBody): UpdateAttendanceSettingsInput => ({
  requireClockInBeforeClockOut: body.requireClockInBeforeClockOut,
  allowEmployeeCancellation: body.allowEmployeeCancellation,
  allowCorrectionRequest: body.allowCorrectionRequest,
  correctionRequiresApproval: body.correctionRequiresApproval,
  gpsEnabled: body.gpsEnabled,
  gpsRequired: body.gpsRequired,
})

/** 各端點 `data` 的型別。由映射函式反推，因此改了映射就會改型別，不會兩邊漂移。 */
export type AttendanceSettingsDetailData = ReturnType<typeof toAttendanceSettingsDetailData>

export const handleAttendanceSettingsGet = async (
  dependencies: AttendanceSettingsDependencies,
  context: EndpointContext<GetBody>,
): Promise<EndpointResult<AttendanceSettingsDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getAttendanceSettings(toAttendanceSettingsContext(dependencies, identity))
  const outcome = resolveServiceResult(result, toNullableAttendanceSettingsDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleAttendanceSettingsUpdate = async (
  dependencies: AttendanceSettingsDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<AttendanceSettingsDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await upsertAttendanceSettings(
    toAttendanceSettingsContext(dependencies, identity),
    toUpdateInput(context.body),
  )
  const outcome = resolveServiceResult(result, toAttendanceSettingsDetailData)
  context.set.status = outcome.status
  return outcome.body
}
