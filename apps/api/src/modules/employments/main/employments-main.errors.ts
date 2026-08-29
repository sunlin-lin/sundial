/**
 * 任職主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。形狀與理由比照
 * `departments/main/departments-main.errors.ts`，不重述。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const EmploymentErrorCode = {
  EmployeeNotFound: 'employments.main.errors.employee-not-found',
  PeriodOverlap: 'employments.main.errors.period-overlap',
  DuplicateHireDate: 'employments.main.errors.duplicate-hire-date',
  NotFound: 'employments.main.errors.not-found',
  AlreadyLeft: 'employments.main.errors.already-left',
  LastWorkingDateAfterLeaveDate: 'employments.main.errors.last-working-date-after-leave-date',
  StateChanged: 'employments.main.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

export type EmploymentErrorCodeValue = (typeof EmploymentErrorCode)[keyof typeof EmploymentErrorCode]

/**
 * `create` 的目標員工不存在。**含「不存在」與「屬於別家公司」與「已被軟刪除」三種情況，三者回同一筆**
 * （§3.2），理由與 `departments` 的 `departmentParentNotFound` 同構——公司條件寫進查詢的
 * `WHERE`，三條路徑走的是同一行程式碼。
 */
export const employmentEmployeeNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmploymentErrorCode.EmployeeNotFound,
  msg: EmploymentErrorCode.EmployeeNotFound,
  data: { field: 'employeeId' },
})

/**
 * §4.3：新任職的到職～離職期間與同一員工既有的有效任職重疊。
 *
 * 這是在**拿到鎖之後**才會出現的業務拒絕，與「拿不到鎖」是兩件事：拿不到鎖時，`FOR UPDATE`
 * 逾時的例外原樣往外拋（系統錯誤，§3.1.2）——那是基礎設施層級的爭用，不是使用者填錯了什麼；
 * 拿到鎖之後才發現真的重疊，才是一句能講給使用者聽的業務訊息。
 */
export const employmentPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmploymentErrorCode.PeriodOverlap,
  msg: EmploymentErrorCode.PeriodOverlap,
  data: { field: 'hireDate' },
})

/** `uq_employee_employments_employee_hire_date` 撞鍵（§4.3 的第二道防線，理由見 `domain/employment-duplicate.ts`）。 */
export const employmentDuplicateHireDate = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmploymentErrorCode.DuplicateHireDate,
  msg: EmploymentErrorCode.DuplicateHireDate,
  data: { field: 'hireDate' },
})

/** 目標任職不存在（動作類端點，§3.1.3）。跨公司存取回同一筆（§3.2）。 */
export const employmentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmploymentErrorCode.NotFound,
  msg: EmploymentErrorCode.NotFound,
  data: { field: 'id' },
})

/** `leave`：這筆任職已經辦過離職（`leave_date` 已有值），離職不是可以重複執行的動作。 */
export const employmentAlreadyLeft = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmploymentErrorCode.AlreadyLeft,
  msg: EmploymentErrorCode.AlreadyLeft,
  data: { field: 'id' },
})

/** `leave`：`last_working_date` 必須 ≤ `leave_date`（計畫 §7 明文約束）。 */
export const employmentLastWorkingDateAfterLeaveDate = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: EmploymentErrorCode.LastWorkingDateAfterLeaveDate,
  msg: EmploymentErrorCode.LastWorkingDateAfterLeaveDate,
  data: { field: 'lastWorkingDate' },
})

/** 條件式 UPDATE 影響 0 列（§4.4）：在讀取與寫入之間，別人已經改過（或辦過離職）這筆任職。 */
export const employmentStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: EmploymentErrorCode.StateChanged,
  msg: EmploymentErrorCode.StateChanged,
  data: { field: 'id' },
})

export type EmploymentErrorDeclaration = {
  readonly code: EmploymentErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: EmploymentErrorCodeValue): EmploymentErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: EmploymentErrorCodeValue): EmploymentErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const EMPLOYMENT_ENDPOINT_ERRORS = {
  get: [],
  list: [],
  create: [
    unprocessable(EmploymentErrorCode.EmployeeNotFound),
    unprocessable(EmploymentErrorCode.PeriodOverlap),
    conflict(EmploymentErrorCode.DuplicateHireDate),
  ],
  leave: [
    unprocessable(EmploymentErrorCode.NotFound),
    unprocessable(EmploymentErrorCode.AlreadyLeft),
    unprocessable(EmploymentErrorCode.LastWorkingDateAfterLeaveDate),
    conflict(EmploymentErrorCode.StateChanged),
  ],
} as const satisfies Record<string, readonly EmploymentErrorDeclaration[]>

export const describeEmploymentErrors = (declarations: readonly EmploymentErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
