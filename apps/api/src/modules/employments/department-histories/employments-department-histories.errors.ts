/**
 * 部門歷史的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。形狀比照 `employments/main/
 * employments-main.errors.ts`，不重述。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const DepartmentHistoryErrorCode = {
  EmploymentNotFound: 'employments.department-histories.errors.employment-not-found',
  DepartmentNotFound: 'employments.department-histories.errors.department-not-found',
  PeriodOverlap: 'employments.department-histories.errors.period-overlap',
  DuplicateEffectiveFrom: 'employments.department-histories.errors.duplicate-effective-from',
} as const satisfies Record<string, ErrorCode>

export type DepartmentHistoryErrorCodeValue =
  (typeof DepartmentHistoryErrorCode)[keyof typeof DepartmentHistoryErrorCode]

/** 目標任職不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const departmentHistoryEmploymentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentHistoryErrorCode.EmploymentNotFound,
  msg: DepartmentHistoryErrorCode.EmploymentNotFound,
  data: { field: 'employmentId' },
})

/** 目標部門不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const departmentHistoryDepartmentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentHistoryErrorCode.DepartmentNotFound,
  msg: DepartmentHistoryErrorCode.DepartmentNotFound,
  data: { field: 'departmentId' },
})

/** §4.3：新的一筆與同一任職既有的有效部門期間重疊。理由與 `employmentPeriodOverlap` 同構。 */
export const departmentHistoryPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: DepartmentHistoryErrorCode.PeriodOverlap,
  msg: DepartmentHistoryErrorCode.PeriodOverlap,
  data: { field: 'effectiveFrom' },
})

/** `uq_employee_department_histories_employment_from` 撞鍵（§4.3 第二道防線）。 */
export const departmentHistoryDuplicateEffectiveFrom = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: DepartmentHistoryErrorCode.DuplicateEffectiveFrom,
  msg: DepartmentHistoryErrorCode.DuplicateEffectiveFrom,
  data: { field: 'effectiveFrom' },
})

export type DepartmentHistoryErrorDeclaration = {
  readonly code: DepartmentHistoryErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: DepartmentHistoryErrorCodeValue): DepartmentHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: DepartmentHistoryErrorCodeValue): DepartmentHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const DEPARTMENT_HISTORY_ENDPOINT_ERRORS = {
  list: [],
  create: [
    unprocessable(DepartmentHistoryErrorCode.EmploymentNotFound),
    unprocessable(DepartmentHistoryErrorCode.DepartmentNotFound),
    unprocessable(DepartmentHistoryErrorCode.PeriodOverlap),
    conflict(DepartmentHistoryErrorCode.DuplicateEffectiveFrom),
  ],
} as const satisfies Record<string, readonly DepartmentHistoryErrorDeclaration[]>

export const describeDepartmentHistoryErrors = (declarations: readonly DepartmentHistoryErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
