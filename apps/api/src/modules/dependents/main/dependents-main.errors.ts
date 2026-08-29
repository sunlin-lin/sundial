/**
 * 眷屬的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。形狀比照
 * `employments/main/employments-main.errors.ts`。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const DependentErrorCode = {
  EmployeeNotFound: 'dependents.main.errors.employee-not-found',
  IdentityNumberDuplicated: 'dependents.main.errors.identity-number-duplicated',
  NotFound: 'dependents.main.errors.not-found',
  AlreadyTerminated: 'dependents.main.errors.already-terminated',
  StateChanged: 'dependents.main.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

export type DependentErrorCodeValue = (typeof DependentErrorCode)[keyof typeof DependentErrorCode]

/** `create` 的目標員工不存在。含「不存在」與「屬於別家公司」與「已被軟刪除」三種情況，三者回同一筆（§3.2）。 */
export const dependentEmployeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DependentErrorCode.EmployeeNotFound,
  msg: DependentErrorCode.EmployeeNotFound,
  data: { field: 'employeeId' },
})

/**
 * 同一位員工已經有一筆同樣身分證字號的眷屬。
 *
 * §3.2：訊息只說重複，不回聲是哪一筆既有眷屬——回聲等於讓建立表單反查這位員工已申報過哪些人。
 */
export const dependentIdentityNumberDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: DependentErrorCode.IdentityNumberDuplicated,
  msg: DependentErrorCode.IdentityNumberDuplicated,
  data: { field: 'identityNumber' },
})

/** 目標眷屬不存在（動作類端點，§3.1.3）。跨公司存取回同一筆（§3.2）。 */
export const dependentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DependentErrorCode.NotFound,
  msg: DependentErrorCode.NotFound,
  data: { field: 'id' },
})

/** `terminate`：這筆眷屬已經終止過扶養，終止不是可以重複執行的動作。 */
export const dependentAlreadyTerminated = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DependentErrorCode.AlreadyTerminated,
  msg: DependentErrorCode.AlreadyTerminated,
  data: { field: 'id' },
})

/** 條件式 UPDATE 影響 0 列（§4.4）：在讀取與寫入之間，別人已經終止（或刪除）了這筆眷屬。 */
export const dependentStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: DependentErrorCode.StateChanged,
  msg: DependentErrorCode.StateChanged,
  data: { field: 'id' },
})

export type DependentErrorDeclaration = {
  readonly code: DependentErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: DependentErrorCodeValue): DependentErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: DependentErrorCodeValue): DependentErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const DEPENDENT_ENDPOINT_ERRORS = {
  list: [],
  create: [unprocessable(DependentErrorCode.EmployeeNotFound), conflict(DependentErrorCode.IdentityNumberDuplicated)],
  terminate: [
    unprocessable(DependentErrorCode.NotFound),
    unprocessable(DependentErrorCode.AlreadyTerminated),
    conflict(DependentErrorCode.StateChanged),
  ],
} as const satisfies Record<string, readonly DependentErrorDeclaration[]>

export const describeDependentErrors = (declarations: readonly DependentErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
