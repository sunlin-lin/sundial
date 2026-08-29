/**
 * 職務歷史的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const JobPositionHistoryErrorCode = {
  EmploymentNotFound: 'employments.job-position-histories.errors.employment-not-found',
  JobPositionNotFound: 'employments.job-position-histories.errors.job-position-not-found',
  PeriodOverlap: 'employments.job-position-histories.errors.period-overlap',
  DuplicateEffectiveFrom: 'employments.job-position-histories.errors.duplicate-effective-from',
} as const satisfies Record<string, ErrorCode>

export type JobPositionHistoryErrorCodeValue =
  (typeof JobPositionHistoryErrorCode)[keyof typeof JobPositionHistoryErrorCode]

/** 目標任職不存在（含跨公司、已軟刪除，三者回同一筆，§3.2）。 */
export const jobPositionHistoryEmploymentNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobPositionHistoryErrorCode.EmploymentNotFound,
  msg: JobPositionHistoryErrorCode.EmploymentNotFound,
  data: { field: 'employmentId' },
})

/**
 * 這一批 `jobPositionIds` 裡至少一個不存在（含跨公司自訂、已軟刪除）。**不回聲是哪一個**
 * （§3.2 同一原則）：回聲會讓呼叫端用這支端點反查公司內／全平台有哪些職務 id 存在。
 */
export const jobPositionHistoryJobPositionNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobPositionHistoryErrorCode.JobPositionNotFound,
  msg: JobPositionHistoryErrorCode.JobPositionNotFound,
  data: { field: 'jobPositionIds' },
})

/**
 * §4.3：這一批裡至少一個職務，其新期間與同一任職、同一職務既有的有效期間重疊。
 *
 * ★ 判斷條件同時看 `employmentId` 與 `jobPositionId`：只看前者會誤擋「同一任職同時擔任兩個
 * 不同職務」，只看後者會誤擋「兩個不同員工的任職被指派同一職務」——本模組的重疊查詢
 * （`impl/employments-job-position-histories.create.service.ts`）一律兩者同時成立。
 */
export const jobPositionHistoryPeriodOverlap = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobPositionHistoryErrorCode.PeriodOverlap,
  msg: JobPositionHistoryErrorCode.PeriodOverlap,
  data: { field: 'effectiveFrom' },
})

/** `uq_employee_job_position_histories_employment_position_from` 撞鍵（§4.3 第二道防線）。 */
export const jobPositionHistoryDuplicateEffectiveFrom = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobPositionHistoryErrorCode.DuplicateEffectiveFrom,
  msg: JobPositionHistoryErrorCode.DuplicateEffectiveFrom,
  data: { field: 'effectiveFrom' },
})

export type JobPositionHistoryErrorDeclaration = {
  readonly code: JobPositionHistoryErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: JobPositionHistoryErrorCodeValue): JobPositionHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: JobPositionHistoryErrorCodeValue): JobPositionHistoryErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const JOB_POSITION_HISTORY_ENDPOINT_ERRORS = {
  list: [],
  create: [
    unprocessable(JobPositionHistoryErrorCode.EmploymentNotFound),
    unprocessable(JobPositionHistoryErrorCode.JobPositionNotFound),
    unprocessable(JobPositionHistoryErrorCode.PeriodOverlap),
    conflict(JobPositionHistoryErrorCode.DuplicateEffectiveFrom),
  ],
} as const satisfies Record<string, readonly JobPositionHistoryErrorDeclaration[]>

export const describeJobPositionHistoryErrors = (
  declarations: readonly JobPositionHistoryErrorDeclaration[],
): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
