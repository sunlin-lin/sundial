/**
 * 業務錯誤 → 表單上要標紅哪一格（前端規範 §6.3、§0.7 拆出來的 `.errors.view.ts` 主題檔）。
 *
 * **這裡是泛型版，不是像 `employees-onboarding.errors.view.ts` 那樣為單一表單寫死一份**：
 * 本頁五個分頁各自是獨立送出的小表單（`employeeCode`／`identityNumber`／`hireDate`／
 * `lastWorkingDate`／`departmentId`／`jobTitleId`／`jobPositionIds`／`effectiveFrom` 分屬不同
 * 分頁、彼此不會同時出現在畫面上），每個分頁各自的欄位 key 集合不同但處理邏輯逐字相同
 * （dot-path 取第一段 → 查已知欄位表 → 對到就標紅，對不到就進 `generalMessages`）。
 * 寫成一支泛型函式，六個分頁只需要各自宣告一份「已知欄位」清單，不必重複六次同一段邏輯。
 *
 * 本頁全部是扁平欄位（沒有陣列型的可編輯列），dot-path 的「路徑」在這裡等於「取第一段當欄位名」，
 * 理由與 `employees-onboarding.errors.view.ts` 檔頭同構，不重述。
 */
import { PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

export type FormErrors<TKey extends string> = {
  readonly fieldErrors: ReadonlyMap<TKey, readonly string[]>
  readonly generalMessages: readonly string[]
}

const fieldOf = (error: EnvelopeError): string | undefined => {
  const field = error.data['field']
  return typeof field === 'string' ? field : undefined
}

/** dot-path 的第一段：`roleIds.3` → `roleIds`，`employeeCode` → `employeeCode`。 */
const rootSegmentOf = (field: string): string => field.split('.')[0] ?? field

const appendMessage = <TKey extends string>(map: Map<TKey, string[]>, key: TKey, message: string): void => {
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, [message])
    return
  }
  existing.push(message)
}

/**
 * `BusinessRuleError.errors` → 表單可以直接查表的形狀。
 *
 * @param knownKeys 這個表單認得的欄位 key（同時也是畫面由上到下的順序，供 {@link firstErroredElementId} 使用）。
 *   對不到 `knownKeys` 裡任何一個的錯誤（多半是編排內部識別碼，例如 `employmentId`／`id`）
 *   一律進 `generalMessages`，不是假裝沒看到。
 */
export const toFormErrors = <TKey extends string>(
  errors: readonly EnvelopeError[],
  knownKeys: readonly TKey[],
): FormErrors<TKey> => {
  const fieldErrors = new Map<TKey, string[]>()
  const generalMessages: string[] = []
  const knownKeySet = new Set<string>(knownKeys)

  for (const error of errors) {
    const field = fieldOf(error)
    const root = field === undefined ? undefined : rootSegmentOf(field)

    if (root !== undefined && knownKeySet.has(root)) {
      appendMessage(fieldErrors, root as TKey, error.msg)
      continue
    }

    generalMessages.push(error.msg)
  }

  return { fieldErrors, generalMessages }
}

const firstMessageOf = <TKey extends string>(errors: FormErrors<TKey>, key: TKey): string | undefined =>
  errors.fieldErrors.get(key)?.[0]

/**
 * `ElFormItem` 的 `error` prop 專用：沒有錯誤時整個鍵都不出現，不是 `{ error: undefined }`
 * ——理由與 `employees-onboarding.errors.view.ts` 的同名函式相同（`exactOptionalPropertyTypes`
 * 底下兩者是不同形狀，`vue-tsc` 會擋，見 `forms-and-lists.md` §1.3）。
 */
export const formItemErrorProp = <TKey extends string>(
  errors: FormErrors<TKey>,
  key: TKey,
): { error: string } | object => {
  const message = firstMessageOf(errors, key)
  return message === undefined ? {} : { error: message }
}

/** 依 `knownKeys` 的順序找第一個有錯誤的欄位，回傳它對應的 DOM id；沒有欄位級錯誤時回 `undefined`。 */
export const firstErroredElementId = <TKey extends string>(
  errors: FormErrors<TKey>,
  knownKeys: readonly TKey[],
  elementIdOf: Record<TKey, string>,
): string | undefined => {
  const key = knownKeys.find((candidate) => errors.fieldErrors.has(candidate))
  return key === undefined ? undefined : elementIdOf[key]
}

export const emptyFormErrors = <TKey extends string>(): FormErrors<TKey> => ({
  fieldErrors: new Map(),
  generalMessages: [],
})

/** 不是 `BusinessRuleError` 時要說的話，理由與 `employees-onboarding.errors.view.ts` 同名函式相同。 */
export const toGeneralFailureMessage = (error: unknown, translate: TranslateMessage): string =>
  error instanceof PermissionDeniedError ? translate('error.no-permission') : translate('error.system')
