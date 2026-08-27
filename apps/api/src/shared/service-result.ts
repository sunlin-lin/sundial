/**
 * 業務錯誤的「收集」模型（§3.1.1）。
 *
 * service 偵測到業務規則不符時把錯誤累積起來、全部檢查跑完才回傳，**不以拋例外表達業務拒絕**。
 * 上游是各模組的 service，下游是 http 邊界層的錯誤映射；本檔不得依賴任何 http 或 elysia 模組
 * ——那正是「同一段業務規則可以被第二種入口呼叫」的支點（§1.0.1）。
 */

/**
 * 錯誤分組。
 *
 * 刻意用具名常數而不是 HTTP 數字：「這個分組在某個入口上對應什麼狀態碼」是**入口的事**，
 * 不是業務層的事。寫成 409／422 之後，這段規則就只能被 Web 前端這一種入口呼叫。
 */
export const ErrorGroup = {
  Conflict: 'conflict',
  Unprocessable: 'unprocessable',
  Forbidden: 'forbidden',
} as const

export type ErrorGroupValue = (typeof ErrorGroup)[keyof typeof ErrorGroup]

/**
 * 錯誤碼，格式為 `<領域>.<原因>`（領域用單數名詞、原因用 kebab-case），例如
 * `auth.invalid-credentials`、`role.already-exists`。禁止編碼式命名（`E4012` 這種）。
 *
 * TODO(下一批業務模組建立各自的 `*.errors.ts` 之後改掉): §1.3 要求錯誤碼收斂成一份集中的
 * `as const` 聯集型別，但目前一個模組都還沒有，聯集無從列舉。先以樣板字面值型別擋住
 * 「格式不對」與「隨手塞一個裸字串」，模組落地後改為各模組錯誤碼常數的聯集，
 * 讓「加入錯誤時只能用聯集內的值」這條型別檢查真正成立。
 */
export type ErrorCode = `${string}.${string}`

export type DomainError = {
  readonly group: ErrorGroupValue
  readonly code: ErrorCode
  readonly msg: string
  /** 慣例帶 `field`（dot-path，§1.3），例如 `items.2.startTime`；禁止放敏感值（§3.2）。 */
  readonly data?: Record<string, unknown>
}

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DomainError[] }

export const succeed = <T>(value: T): ServiceResult<T> => ({ ok: true, value })

/**
 * 失敗結果。
 *
 * 參數是「整包錯誤」而不是單筆，形狀上就逼呼叫端先把檢查跑完再回傳——收一筆的簽章
 * 會讓「第一筆就 return」變成最順手的寫法，而那正是 §3.1.1 要防的事：`errors` 陣列
 * 從此永遠只裝得下一個元素，前端為多筆錯誤寫的定位邏輯等於白寫。
 */
export const fail = (errors: readonly DomainError[]): ServiceResult<never> => ({ ok: false, errors })
