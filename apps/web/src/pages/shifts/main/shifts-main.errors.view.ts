/**
 * 業務錯誤 → 表單上要標紅哪一格（前端規範 §6.3、依 §0.7 拆出來的 `.errors.view.ts` 主題檔）。
 *
 * 這一頁的 `errors[].data.field` 有兩種形狀：
 *
 * - **列級**：`workPeriods.0.endTime`、`breaks.2.startTime` —— 對到時段／休息編輯器裡的某一列。
 * - **表單級**：`code`（代碼重複）、`workPeriods`（零段時段、或 `requiredWorkMinutes` 不是正值）、
 *   `id`／`sourceId`（目標不存在）—— 不對到任何一列，走全域提示（§6.3 的保底路徑）。
 *
 * **這裡不是 `el-form-item` 的 `prop` 綁定**：時段與休息是使用者可以新增／刪除的陣列列，
 * 不是固定欄位的靜態表單，`ElForm` 的驗證機制在這種「列可以整組換掉」的形狀上並不合適
 * （§6.3 的 `prop` 對接指的是一般表單；本檔改用一個 index → 訊息陣列的 map，由編輯器元件自己
 * 依列的索引查表、就地顯示——效果相同：使用者看得出「是哪一列」，只是實作走的是資料而非
 * Element Plus 的表單驗證 API）。
 */
import { BusinessRuleError, PermissionDeniedError } from '../../../shared/api/api-error.ts'
import type { EnvelopeError } from '../../../shared/api/envelope.ts'
import type { TranslateMessage } from '../../../shared/i18n/messages.ts'

/** 一個索引 → 那一列的錯誤訊息（可能不只一則）。 */
export type RowFieldErrors = ReadonlyMap<number, readonly string[]>

export type ShiftFormErrors = {
  readonly workPeriodErrors: RowFieldErrors
  readonly breakErrors: RowFieldErrors
  /** 不對應任何一列的錯誤：代碼重複、零段時段、應工作分鐘不是正值、目標不存在。 */
  readonly generalMessages: readonly string[]
}

const ROW_FIELD_PATTERN = /^(workPeriods|breaks)\.(\d+)\./

/** `\d+` 已經由上面那個 pattern 保證只含數字字元，逐位累加即可，不需要 `Number(`／`parseInt(`
 * （理由與 `shifts-main.duration.view.ts` 的 `digitsToInteger` 相同，這裡的值同樣是陣列索引，
 * 範圍極小，不重複那一份較長的說明）。 */
const digitsToIndex = (digits: string): number =>
  Array.from(digits).reduce((total, char) => total * 10 + (char.codePointAt(0) ?? 48) - 48, 0)

const fieldOf = (error: EnvelopeError): string | undefined => {
  const field = error.data['field']
  return typeof field === 'string' ? field : undefined
}

/** 把一組列錯誤（index → 訊息陣列）累加一則新訊息，回傳新的 Map（不改動傳入的那一份）。 */
const appendRowError = (map: Map<number, string[]>, index: number, message: string): void => {
  const existing = map.get(index)
  if (existing === undefined) {
    map.set(index, [message])
    return
  }
  existing.push(message)
}

/**
 * `BusinessRuleError.errors` → 表單可以直接查表的形狀。
 *
 * 依序處理每一則：能解析出 `<section>.<index>.<欄位>` 就歸進對應列，其餘（含完全沒有 `field`
 * 的錯誤，§6.3 的保底路徑）一律進 `generalMessages`。
 */
export const toShiftFormErrors = (errors: readonly EnvelopeError[]): ShiftFormErrors => {
  const workPeriodErrors = new Map<number, string[]>()
  const breakErrors = new Map<number, string[]>()
  const generalMessages: string[] = []

  for (const error of errors) {
    const field = fieldOf(error)
    const match = field === undefined ? null : ROW_FIELD_PATTERN.exec(field)

    if (match === null) {
      generalMessages.push(error.msg)
      continue
    }

    const [, section, indexText] = match
    const index = digitsToIndex(indexText ?? '')
    appendRowError(section === 'workPeriods' ? workPeriodErrors : breakErrors, index, error.msg)
  }

  return { workPeriodErrors, breakErrors, generalMessages }
}

/**
 * 簡單確認式動作（刪除、啟用／停用）失敗時要顯示的一句話——這兩種動作沒有表單可以就地標紅，
 * 只需要一句 `ElMessage`。依 §3.6 分流：`901` 顯示「無權限」而不是系統錯誤（絕對不可導登入頁，
 * 那是導頁層的事，這裡只負責文字）；業務錯誤（`code='300'`）顯示後端回來的第一則 `msg`
 *（前端不準備第二份文案）；其餘一律系統錯誤文案。
 */
export const toGeneralFailureMessage = (error: unknown, translate: TranslateMessage): string => {
  if (error instanceof PermissionDeniedError) return translate('error.no-permission')
  if (error instanceof BusinessRuleError) return error.errors[0]?.msg ?? error.message
  return translate('error.system')
}
