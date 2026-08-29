/**
 * 業務錯誤 → 表單上要標紅哪一格（前端規範 §6.3、依 §0.7 拆出來的 `.errors.view.ts` 主題檔）。
 *
 * `POST /employees/onboarding/create` 可能吐出的 `errors[].data.field`（見
 * `employees-onboarding.errors.ts` 收斂的各模組錯誤字典）分兩種：
 *
 * - **對到本頁一個實際欄位**：`employeeCode`／`identityNumber`／`hireDate`／`departmentId`／
 *   `jobTitleId`／`jobPositionIds`／`username`／`roleIds`（含索引形式 `roleIds.<N>`，
 *   來自 `company-users-roles.errors.ts` 的 `roleNotFound`／`roleInactive`／`roleAlreadyAssigned`）。
 * - **對到編排過程中的內部識別碼**（`employeeId`／`employmentId`／`effectiveFrom`／
 *   `companyUserId`）：這些欄位不在本表單上，依編排順序的檔頭註解「理論上不會發生」，
 *   但契約要誠實列出——真的收到時走 `generalMessages`（§6.3 的保底路徑），不是假裝沒看到。
 *
 * **`roleIds.<N>` 收斂成 `roleIds` 這一個 key，不逐一標到第 N 個選項**：本頁的角色是
 * `ElTreeSelect` 的 multiple 選單而不是逐列可編輯的表格列，選單裡沒有「第 N 個 chip 標紅」
 * 這種呈現方式可用（不像 `shifts-main.errors.view.ts` 的時段／休息是逐列表格）。
 * 索引因此只用來確認「這確實是一則 `roleIds` 的錯誤」，訊息本身仍然完整顯示給使用者。
 *
 * **這裡不是共用的 dot-path 解析函式**：本表單全部是扁平欄位（沒有陣列型的可編輯列），
 * dot-path 的「路徑」在這裡等於「取第一段當作欄位名」，比 `shifts-main` 那種列索引解析單純得多，
 * 因此照 §1.5 的判準留在頁面目錄，等真的有第二個「扁平表單＋這種錯誤形狀」的頁面出現，
 * 才是評估搬進 `shared/` 的時機（理由同 `list-echo.ts` 檔頭的「等第二個使用者」）。
 */
import { PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 本表單認得的欄位 key，同時也是 `EmployeeOnboardingFormState` 裡對應到後端欄位名的那幾個。 */
export type OnboardingFieldKey =
  | 'employeeCode'
  | 'identityNumber'
  | 'hireDate'
  | 'departmentId'
  | 'jobTitleId'
  | 'jobPositionIds'
  | 'username'
  | 'roleIds'

const KNOWN_FIELD_KEYS: readonly OnboardingFieldKey[] = [
  'employeeCode',
  'identityNumber',
  'hireDate',
  'departmentId',
  'jobTitleId',
  'jobPositionIds',
  'username',
  'roleIds',
]

export type OnboardingFormErrors = {
  readonly fieldErrors: ReadonlyMap<OnboardingFieldKey, readonly string[]>
  readonly generalMessages: readonly string[]
}

const fieldOf = (error: EnvelopeError): string | undefined => {
  const field = error.data['field']
  return typeof field === 'string' ? field : undefined
}

/** dot-path 的第一段：`roleIds.3` → `roleIds`，`employeeCode` → `employeeCode`（沒有 `.` 就是它自己）。 */
const rootSegmentOf = (field: string): string => field.split('.')[0] ?? field

const isKnownFieldKey = (root: string): root is OnboardingFieldKey =>
  (KNOWN_FIELD_KEYS as readonly string[]).includes(root)

const appendMessage = (map: Map<OnboardingFieldKey, string[]>, key: OnboardingFieldKey, message: string): void => {
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, [message])
    return
  }
  existing.push(message)
}

/** `BusinessRuleError.errors` → 表單可以直接查表的形狀。 */
export const toOnboardingFormErrors = (errors: readonly EnvelopeError[]): OnboardingFormErrors => {
  const fieldErrors = new Map<OnboardingFieldKey, string[]>()
  const generalMessages: string[] = []

  for (const error of errors) {
    const field = fieldOf(error)
    const root = field === undefined ? undefined : rootSegmentOf(field)

    if (root !== undefined && isKnownFieldKey(root)) {
      appendMessage(fieldErrors, root, error.msg)
      continue
    }

    generalMessages.push(error.msg)
  }

  return { fieldErrors, generalMessages }
}

/** 單一欄位的第一則錯誤訊息（沒有錯誤時回 `undefined`）。內部使用；模板請用 {@link formItemErrorProp}。 */
const firstMessageOf = (errors: OnboardingFormErrors, key: OnboardingFieldKey): string | undefined =>
  errors.fieldErrors.get(key)?.[0]

/**
 * `ElFormItem` 的 `error` prop 專用：**沒有錯誤時整個鍵都不出現，不是 `{ error: undefined }`**。
 *
 * `ElFormItem.error` 宣告成 `error?: string`，本專案的 `exactOptionalPropertyTypes: true`
 * 底下「可選」與「可以明確賦值 `undefined`」是兩種不同的形狀（通用規範 §2.1）——直接寫
 * `:error="firstErrorOf(...)"` 在沒有錯誤時會把 `undefined` 指派給這個 prop，`vue-tsc` 判定為
 * 型別不符。用 `v-bind="formItemErrorProp(...)"` 搭配這支回傳「有鍵或沒有鍵」的函式，
 * 從源頭就不會產生 `{ error: undefined }` 這個形狀。
 */
export const formItemErrorProp = (
  errors: OnboardingFormErrors,
  key: OnboardingFieldKey,
): { error: string } | object => {
  const message = firstMessageOf(errors, key)
  return message === undefined ? {} : { error: message }
}

/**
 * 每個欄位對應的 DOM id（§6.3「捲動到第一個錯誤欄位」）。各區塊子元件把對應欄位的
 * `ElFormItem` 標上同一個 id，`.page.vue` 收到 `300` 之後只需要知道「該捲去哪一個 id」，
 * 不必知道那個 id 屬於哪一個子元件——DOM 是全頁唯一的命名空間，這件事不需要跨元件傳參數。
 */
export const FIELD_ELEMENT_ID: Record<OnboardingFieldKey, string> = {
  employeeCode: 'employee-onboarding-field-employee-code',
  identityNumber: 'employee-onboarding-field-identity-number',
  hireDate: 'employee-onboarding-field-hire-date',
  departmentId: 'employee-onboarding-field-department-id',
  jobTitleId: 'employee-onboarding-field-job-title-id',
  jobPositionIds: 'employee-onboarding-field-job-position-ids',
  username: 'employee-onboarding-field-username',
  roleIds: 'employee-onboarding-field-role-ids',
}

/** 依畫面由上到下的順序找第一個有錯誤的欄位，回傳它的 DOM id；沒有欄位級錯誤時回 `undefined`。 */
export const firstErroredElementId = (errors: OnboardingFormErrors): string | undefined => {
  const key = KNOWN_FIELD_KEYS.find((candidate) => errors.fieldErrors.has(candidate))
  return key === undefined ? undefined : FIELD_ELEMENT_ID[key]
}

/** 空的錯誤集合，重新送出前用來清掉上一輪的標紅（`.page.vue` 送出時先重置）。 */
export const emptyOnboardingFormErrors = (): OnboardingFormErrors => ({ fieldErrors: new Map(), generalMessages: [] })

/**
 * 不是 `BusinessRuleError` 時要說的話——`901` 顯示「無權限」（絕對不可導登入頁，那是 client 層
 * 的事，這裡只負責文字），其餘一律系統錯誤文案（§3.6，不對使用者顯示後端細節）。
 */
export const toGeneralFailureMessage = (error: unknown, translate: TranslateMessage): string =>
  error instanceof PermissionDeniedError ? translate('error.no-permission') : translate('error.system')
