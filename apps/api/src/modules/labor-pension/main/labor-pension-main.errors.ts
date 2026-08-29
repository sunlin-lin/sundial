/** 勞退自願提繳率設定的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。形狀比照 `withholding-main.errors.ts`。 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const LaborPensionErrorCode = {
  EmployeeNotFound: 'labor-pension.main.errors.employee-not-found',
  PeriodOverlap: 'labor-pension.main.errors.period-overlap',
  DuplicateEffectiveFrom: 'labor-pension.main.errors.duplicate-effective-from',
} as const satisfies Record<string, ErrorCode>

export type LaborPensionErrorCodeValue = (typeof LaborPensionErrorCode)[keyof typeof LaborPensionErrorCode]

/** 目標員工不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const laborPensionEmployeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: LaborPensionErrorCode.EmployeeNotFound,
  msg: LaborPensionErrorCode.EmployeeNotFound,
  data: { field: 'employeeId' },
})

/** §4.3：新的一筆與同一員工既有的有效勞退設定期間重疊。理由與 `withholdingPeriodOverlap` 同構。 */
export const laborPensionPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: LaborPensionErrorCode.PeriodOverlap,
  msg: LaborPensionErrorCode.PeriodOverlap,
  data: { field: 'effectiveFrom' },
})

/** `uq_employee_labor_pension_settings_employee_from` 撞鍵（§4.3 第二道防線）。 */
export const laborPensionDuplicateEffectiveFrom = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: LaborPensionErrorCode.DuplicateEffectiveFrom,
  msg: LaborPensionErrorCode.DuplicateEffectiveFrom,
  data: { field: 'effectiveFrom' },
})

export type LaborPensionErrorDeclaration = {
  readonly code: LaborPensionErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: LaborPensionErrorCodeValue): LaborPensionErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: LaborPensionErrorCodeValue): LaborPensionErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const LABOR_PENSION_ENDPOINT_ERRORS = {
  list: [],
  create: [
    unprocessable(LaborPensionErrorCode.EmployeeNotFound),
    unprocessable(LaborPensionErrorCode.PeriodOverlap),
    conflict(LaborPensionErrorCode.DuplicateEffectiveFrom),
  ],
} as const satisfies Record<string, readonly LaborPensionErrorDeclaration[]>

export const describeLaborPensionErrors = (declarations: readonly LaborPensionErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
