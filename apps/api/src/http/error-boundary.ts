/**
 * 邊界層錯誤映射（handler 之後、envelope 產生函式之前，§1.8.2）。
 *
 * 唯一職責：把 service 回傳的**整包**錯誤集合映射成 HTTP status ＋ envelope `code` ＋ `errors[]`。
 * 它**不判斷業務規則成不成立**（那是 service 的事），也**不只取第一筆**
 * ——只取第一筆的話，「整體回 409 還是 422」就變成由「哪一條檢查剛好排在前面」決定。
 */
import { logicError, ok, permissionDenied, systemError, toErrorView, type EnvelopeBody } from '../shared/envelope.ts'
import { ErrorGroup, type DomainError, type ServiceResult } from '../shared/service-result.ts'
import { logger, LogCategory } from '../shared/logger.ts'
import { HttpStatus, type HttpStatusValue } from './http-code-map.ts'

export type BoundaryResponse<TData> = {
  readonly status: HttpStatusValue
  readonly body: EnvelopeBody<TData>
}

/**
 * 映射規則（§3.1.1）：
 * 集合內出現任一 `Forbidden` → 整體 403／`901`；否則有 `Conflict` → 409／`300`；其餘 → 422／`300`。
 */
export const mapDomainErrors = (errors: readonly DomainError[]): BoundaryResponse<null> => {
  const first = errors[0]
  if (first === undefined) {
    // service 回了失敗卻沒有任何錯誤，這是程式錯誤而不是業務拒絕：回 `300` 會讓使用者
    // 看到一個沒有內容的業務錯誤，而真正的 bug 沒有任何人知道。走系統錯誤路徑才會進告警。
    logger.error(LogCategory.UnhandledException, 'service 回傳失敗結果但錯誤集合為空')
    return { status: HttpStatus.InternalServerError, body: systemError() }
  }

  if (errors.some((error) => error.group === ErrorGroup.Forbidden)) {
    // `901` 依 §1.3 一律不帶 errors：前端對它的處置只有一種（顯示無權限），不需要細節；
    // 而揭露「你是因為不是本人才被擋」本身就是資訊外洩（§3.2）。細節只進 log。
    logger.warn(LogCategory.PermissionDenied, '請求被權限規則拒絕', {
      codes: errors.filter((error) => error.group === ErrorGroup.Forbidden).map((error) => error.code),
    })
    return { status: HttpStatus.Forbidden, body: permissionDenied() }
  }

  const status = errors.some((error) => error.group === ErrorGroup.Conflict)
    ? HttpStatus.Conflict
    : HttpStatus.UnprocessableEntity

  // `msg` 取第一筆只是為了讓不看 `errors` 的呼叫端有東西顯示；前端的處置一律綁在
  // `errors[].code` 上（§1.3），完整清單一筆都不會少。
  //
  // 插值參數要跟著同一筆一起帶走：只帶 `msg` 不帶 `params` 的話，頂層那句話會留著一串
  // `{{assignedUserCount}}` 送到使用者面前——而 `errors[0].msg` 是好的，所以看畫面的人
  // 只會覺得「有時候會有奇怪的括號」，不會有任何一層報錯。
  return { status, body: logicError(errors.map(toErrorView), first.msg, first.params) }
}

/**
 * 把 service 的結果收成 HTTP 回應。
 *
 * @param result service 回傳的成功值或錯誤集合。
 * @param toData 把業務資料映射成本端點的 `data` 形狀。**必填且必須是明確的映射函式**——
 *   直接把 service 或 repository 的回傳值指派給 `data`，資料表加一個欄位就會自動出現在 API 上，
 *   而且沒有任何一行程式碼會改變（§1.8.0、§2）。
 */
export const resolveServiceResult = <TValue, TData>(
  result: ServiceResult<TValue>,
  toData: (value: TValue) => TData,
): BoundaryResponse<TData> | BoundaryResponse<null> =>
  result.ok ? { status: HttpStatus.Ok, body: ok(toData(result.value)) } : mapDomainErrors(result.errors)
