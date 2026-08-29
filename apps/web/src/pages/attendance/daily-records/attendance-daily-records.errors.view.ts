/**
 * 業務錯誤 → 畫面要說什麼話（前端規範 §6.3、§0.7 拆出來的 `.errors.view.ts` 主題檔）。
 *
 * 列表載入與明細載入的失敗分流用 `shared/api/load-failure.ts`（無權限 vs 系統錯誤，§7.2），
 * 本檔只處理撤銷原因表單——與 `dashboard-main.errors.view.ts` 同構，差別只在這裡呼叫的是
 * `revoke-other`（他人撤銷）：目前宣告的業務錯誤（`not-found`／`already-revoked`／
 * `clock-out-must-be-revoked-first`／`period-locked`）同樣沒有一個帶 `field: 'reason'`
 * （撤銷原因的必填／長度由 TypeBox 在進 service 之前就擋下來，回 `100`，不是 `300`），
 * 因此 `reasonMessage` 目前實務上永遠是 `null`；仍照規範寫出 dot-path 定位，理由同該檔。
 *
 * **`period-locked` 的訊息不在這裡另外寫一份**：後端 `attendance.records.errors.period-locked`
 * 的中文訊息（`apps/api/src/shared/i18n/locales/zh-TW/attendance.ts`）已經是 UI 23 要求的那句
 * 「這個工作日的薪資已結算，如需更正請改走補打卡流程」，`toGeneralFailureMessage` 直接顯示
 * 後端回來的 `msg`，不需要前端準備第二份文案（§3.6、語系檔檔頭的既有界線）。
 */
import { BusinessRuleError, PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

export type RevokeOtherFormErrors = {
  readonly reasonMessage: string | null
  readonly generalMessages: readonly string[]
}

const fieldOf = (error: EnvelopeError): string | undefined => {
  const field = error.data['field']
  return typeof field === 'string' ? field : undefined
}

export const emptyRevokeOtherFormErrors = (): RevokeOtherFormErrors => ({ reasonMessage: null, generalMessages: [] })

export const toRevokeOtherFormErrors = (errors: readonly EnvelopeError[]): RevokeOtherFormErrors => {
  let reasonMessage: string | null = null
  const generalMessages: string[] = []

  for (const error of errors) {
    if (fieldOf(error) === 'reason' && reasonMessage === null) {
      reasonMessage = error.msg
      continue
    }
    generalMessages.push(error.msg)
  }

  return { reasonMessage, generalMessages }
}

/** `ElFormItem` 的 `error` prop 專用：沒有錯誤時整個鍵都不出現（`exactOptionalPropertyTypes`）。 */
export const revokeOtherFormItemErrorProp = (errors: RevokeOtherFormErrors): { error: string } | object =>
  errors.reasonMessage === null ? {} : { error: errors.reasonMessage }

/**
 * 簡單確認式動作（撤銷）失敗時要顯示的一句話。依 §3.6 分流：`901` 顯示「無權限」（絕對不可導
 * 登入頁）；業務錯誤（`code='300'`）顯示後端回來的第一則 `msg`（前端不準備第二份文案，
 * 含 `period-locked` 那一句，見檔頭）；其餘一律系統錯誤文案。
 */
export const toGeneralFailureMessage = (error: unknown, translate: TranslateMessage): string => {
  if (error instanceof PermissionDeniedError) return translate('error.no-permission')
  if (error instanceof BusinessRuleError) return error.errors[0]?.msg ?? error.message
  return translate('error.system')
}
