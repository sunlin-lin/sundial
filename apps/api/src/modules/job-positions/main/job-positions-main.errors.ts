/**
 * 職務主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4、§1.8.3）。形狀比照
 * `job-titles/main/job-titles-main.errors.ts`，不重述。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const JobPositionErrorCode = {
  CodeDuplicated: 'job-positions.main.errors.code-duplicated',
  NotFound: 'job-positions.main.errors.not-found',
  StateChanged: 'job-positions.main.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

export type JobPositionErrorCodeValue = (typeof JobPositionErrorCode)[keyof typeof JobPositionErrorCode]

export const jobPositionCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobPositionErrorCode.CodeDuplicated,
  msg: JobPositionErrorCode.CodeDuplicated,
  data: { field: 'code' },
})

export const jobPositionNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobPositionErrorCode.NotFound,
  msg: JobPositionErrorCode.NotFound,
  data: { field: 'id' },
})

export const jobPositionStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobPositionErrorCode.StateChanged,
  msg: JobPositionErrorCode.StateChanged,
  data: { field: 'id' },
})

export type JobPositionErrorDeclaration = {
  readonly code: JobPositionErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: JobPositionErrorCodeValue): JobPositionErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: JobPositionErrorCodeValue): JobPositionErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const JOB_POSITION_ENDPOINT_ERRORS = {
  list: [],
  get: [],
  create: [conflict(JobPositionErrorCode.CodeDuplicated)],
  update: [unprocessable(JobPositionErrorCode.NotFound), conflict(JobPositionErrorCode.CodeDuplicated)],
  delete: [unprocessable(JobPositionErrorCode.NotFound), conflict(JobPositionErrorCode.StateChanged)],
} as const satisfies Record<string, readonly JobPositionErrorDeclaration[]>

export const describeJobPositionErrors = (declarations: readonly JobPositionErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
