/** 扣繳設定的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。形狀比照 `employments-main.errors.ts`。 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const WithholdingErrorCode = {
  EmployeeNotFound: 'withholding.main.errors.employee-not-found',
  PeriodOverlap: 'withholding.main.errors.period-overlap',
  DuplicateEffectiveFrom: 'withholding.main.errors.duplicate-effective-from',
} as const satisfies Record<string, ErrorCode>

export type WithholdingErrorCodeValue = (typeof WithholdingErrorCode)[keyof typeof WithholdingErrorCode]

/** 目標員工不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const withholdingEmployeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: WithholdingErrorCode.EmployeeNotFound,
  msg: WithholdingErrorCode.EmployeeNotFound,
  data: { field: 'employeeId' },
})

/** §4.3：新的一筆與同一員工既有的有效扣繳期間重疊。理由與 `employmentPeriodOverlap` 同構。 */
export const withholdingPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: WithholdingErrorCode.PeriodOverlap,
  msg: WithholdingErrorCode.PeriodOverlap,
  data: { field: 'effectiveFrom' },
})

/** `uq_employee_withholding_settings_employee_from` 撞鍵（§4.3 第二道防線）。 */
export const withholdingDuplicateEffectiveFrom = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: WithholdingErrorCode.DuplicateEffectiveFrom,
  msg: WithholdingErrorCode.DuplicateEffectiveFrom,
  data: { field: 'effectiveFrom' },
})

export type WithholdingErrorDeclaration = {
  readonly code: WithholdingErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: WithholdingErrorCodeValue): WithholdingErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: WithholdingErrorCodeValue): WithholdingErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const WITHHOLDING_ENDPOINT_ERRORS = {
  list: [],
  create: [
    unprocessable(WithholdingErrorCode.EmployeeNotFound),
    unprocessable(WithholdingErrorCode.PeriodOverlap),
    conflict(WithholdingErrorCode.DuplicateEffectiveFrom),
  ],
} as const satisfies Record<string, readonly WithholdingErrorDeclaration[]>

export const describeWithholdingErrors = (declarations: readonly WithholdingErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
