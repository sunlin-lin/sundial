/**
 * 職稱歷史的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。形狀比照
 * `department-histories/employments-department-histories.errors.ts`。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const JobTitleHistoryErrorCode = {
  EmploymentNotFound: 'employments.job-title-histories.errors.employment-not-found',
  JobTitleNotFound: 'employments.job-title-histories.errors.job-title-not-found',
  PeriodOverlap: 'employments.job-title-histories.errors.period-overlap',
  DuplicateEffectiveFrom: 'employments.job-title-histories.errors.duplicate-effective-from',
} as const satisfies Record<string, ErrorCode>

export type JobTitleHistoryErrorCodeValue = (typeof JobTitleHistoryErrorCode)[keyof typeof JobTitleHistoryErrorCode]

/** 目標任職不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const jobTitleHistoryEmploymentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobTitleHistoryErrorCode.EmploymentNotFound,
  msg: JobTitleHistoryErrorCode.EmploymentNotFound,
  data: { field: 'employmentId' },
})

/** 目標職稱不存在（含跨公司自訂、已軟刪除；系統預設職稱不受此影響，見 find-job-title 切片）。 */
export const jobTitleHistoryJobTitleNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobTitleHistoryErrorCode.JobTitleNotFound,
  msg: JobTitleHistoryErrorCode.JobTitleNotFound,
  data: { field: 'jobTitleId' },
})

/** §4.3：新的一筆與同一任職既有的有效職稱期間重疊。 */
export const jobTitleHistoryPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobTitleHistoryErrorCode.PeriodOverlap,
  msg: JobTitleHistoryErrorCode.PeriodOverlap,
  data: { field: 'effectiveFrom' },
})

/** `uq_employee_job_title_histories_employment_from` 撞鍵（§4.3 第二道防線）。 */
export const jobTitleHistoryDuplicateEffectiveFrom = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobTitleHistoryErrorCode.DuplicateEffectiveFrom,
  msg: JobTitleHistoryErrorCode.DuplicateEffectiveFrom,
  data: { field: 'effectiveFrom' },
})

export type JobTitleHistoryErrorDeclaration = {
  readonly code: JobTitleHistoryErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: JobTitleHistoryErrorCodeValue): JobTitleHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: JobTitleHistoryErrorCodeValue): JobTitleHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const JOB_TITLE_HISTORY_ENDPOINT_ERRORS = {
  list: [],
  create: [
    unprocessable(JobTitleHistoryErrorCode.EmploymentNotFound),
    unprocessable(JobTitleHistoryErrorCode.JobTitleNotFound),
    unprocessable(JobTitleHistoryErrorCode.PeriodOverlap),
    conflict(JobTitleHistoryErrorCode.DuplicateEffectiveFrom),
  ],
} as const satisfies Record<string, readonly JobTitleHistoryErrorDeclaration[]>

export const describeJobTitleHistoryErrors = (declarations: readonly JobTitleHistoryErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
