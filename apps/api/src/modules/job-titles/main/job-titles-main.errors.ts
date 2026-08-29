/**
 * 職稱主檔的錯誤字典 ＋ 各端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。形狀比照
 * `departments/main/departments-main.errors.ts`，不重述共通理由。
 */
import { ErrorGroup, type DomainError, type ErrorCode, type ErrorGroupValue } from '../../../shared/service-result.ts'

export const JobTitleErrorCode = {
  CodeDuplicated: 'job-titles.main.errors.code-duplicated',
  NotFound: 'job-titles.main.errors.not-found',
  StateChanged: 'job-titles.main.errors.state-changed',
} as const satisfies Record<string, ErrorCode>

export type JobTitleErrorCodeValue = (typeof JobTitleErrorCode)[keyof typeof JobTitleErrorCode]

/** 代碼重複。分組 `Conflict`（→ 409），理由與 `departmentCodeDuplicated` 同構。不回聲既有列。 */
export const jobTitleCodeDuplicated = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobTitleErrorCode.CodeDuplicated,
  msg: JobTitleErrorCode.CodeDuplicated,
  data: { field: 'code' },
})

/**
 * 目標職稱不存在。**跨公司存取、系統預設職稱（不能被公司修改／刪除）、已軟刪除三者回同一筆**
 * （§3.2）：`update`／`delete` 走 `TenantDatabase` 標準 scope，三種情況查詢結果都是「找不到」，
 * 走的是同一行程式碼。
 */
export const jobTitleNotFound = (): DomainError => ({
  group: ErrorGroup.Unprocessable,
  code: JobTitleErrorCode.NotFound,
  msg: JobTitleErrorCode.NotFound,
  data: { field: 'id' },
})

/** 條件式 UPDATE／軟刪除影響 0 列（§4.4）：讀取與寫入之間，別人已經改過或刪掉這筆資料。 */
export const jobTitleStateChanged = (): DomainError => ({
  group: ErrorGroup.Conflict,
  code: JobTitleErrorCode.StateChanged,
  msg: JobTitleErrorCode.StateChanged,
  data: { field: 'id' },
})

export type JobTitleErrorDeclaration = {
  readonly code: JobTitleErrorCodeValue
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: JobTitleErrorCodeValue): JobTitleErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: JobTitleErrorCodeValue): JobTitleErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

export const JOB_TITLE_ENDPOINT_ERRORS = {
  list: [],
  get: [],
  create: [conflict(JobTitleErrorCode.CodeDuplicated)],
  update: [unprocessable(JobTitleErrorCode.NotFound), conflict(JobTitleErrorCode.CodeDuplicated)],
  delete: [unprocessable(JobTitleErrorCode.NotFound), conflict(JobTitleErrorCode.StateChanged)],
} as const satisfies Record<string, readonly JobTitleErrorDeclaration[]>

export const describeJobTitleErrors = (declarations: readonly JobTitleErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
