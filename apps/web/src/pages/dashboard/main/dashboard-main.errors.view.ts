/**
 * 業務錯誤 → 畫面要說什麼話（前端規範 §6.3、§0.7 拆出來的 `.errors.view.ts` 主題檔）。
 *
 * 這一頁有兩種錯誤消費情境：
 *
 * - **撤銷原因表單**：唯一可能對到欄位的 dot-path 是 `reason`（依 §6.3 定位到 `ElFormItem`）。
 *   目前 `attendance.records.revoke` 宣告的業務錯誤（`not-found`／`already-revoked`／
 *   `clock-out-must-be-revoked-first`／`period-locked`）沒有一個帶 `field: 'reason'`——
 *   `Reason` 欄位的必填／長度由 TypeBox 在進 service 之前就擋下來（回 `100`，不是 `300`），
 *   因此 `reasonMessage` 目前實務上永遠是 `null`。仍然照規範寫出 dot-path 定位，
 *   是為了不讓「這一頁沒有欄位級錯誤」這件事只存在於一次性的觀察裡——後端字典改了以後
 *   （例如哪天 `revoke` 真的加一條對到 `reason` 的規則），這裡不必跟著改。
 * - **打卡按鈕**（上班／下班）：沒有表單可以標紅，只需要一句 `ElMessage`，比照
 *   `shifts-main.errors.view.ts` 的 `toGeneralFailureMessage`。
 */
import { BusinessRuleError, PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

export type RevokeFormErrors = {
  readonly reasonMessage: string | null
  readonly generalMessages: readonly string[]
}

const fieldOf = (error: EnvelopeError): string | undefined => {
  const field = error.data['field']
  return typeof field === 'string' ? field : undefined
}

export const emptyRevokeFormErrors = (): RevokeFormErrors => ({ reasonMessage: null, generalMessages: [] })

export const toRevokeFormErrors = (errors: readonly EnvelopeError[]): RevokeFormErrors => {
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

/** `ElFormItem` 的 `error` prop 專用：沒有錯誤時整個鍵都不出現（`exactOptionalPropertyTypes`，
 * 理由與 `employees-detail.errors.view.ts` 的同名函式相同）。 */
export const revokeFormItemErrorProp = (errors: RevokeFormErrors): { error: string } | object =>
  errors.reasonMessage === null ? {} : { error: errors.reasonMessage }

/**
 * 簡單確認式動作（打卡、撤銷）失敗時要顯示的一句話。依 §3.6 分流：`901` 顯示「無權限」
 * （絕對不可導登入頁）；業務錯誤（`code='300'`）顯示後端回來的第一則 `msg`（前端不準備第二份
 * 文案）；其餘一律系統錯誤文案。
 */
export const toGeneralFailureMessage = (error: unknown, translate: TranslateMessage): string => {
  if (error instanceof PermissionDeniedError) return translate('error.no-permission')
  if (error instanceof BusinessRuleError) return error.errors[0]?.msg ?? error.message
  return translate('error.system')
}
