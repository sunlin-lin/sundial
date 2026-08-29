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
import type { AttendanceResultsContext } from './domain/attendance-result-context.ts'
import { recalculateAllNoScheduleAttendanceResults } from './attendance-results.service.ts'

/** 由組裝點注入的相依。公司範圍不在裡面——只能來自每一次請求的已驗證身分（§4.2）。 */
export type AttendanceResultsDependencies = Omit<AttendanceResultsContext, 'companyId'>

/** 與 `attendance-records.handler.ts` 相同的結構型別化 context。 */
export type EndpointContext = {
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
