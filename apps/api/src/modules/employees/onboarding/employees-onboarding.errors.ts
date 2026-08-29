/**
 * 到職編排端點的錯誤碼宣告（§0.4「errors 不拆」、§1.8.3）。
 *
 * **本檔不定義新的錯誤碼，只收斂既有的。** 每一項業務拒絕的規則都屬於它原本所在的模組
 * （員工編號重複是 `employees` 的規則、角色不存在是 `company-users/roles` 的規則……），
 * `createOnboardingInTransaction` 只是原樣把子動作回傳的 `DomainError` 往外傳（見
 * `impl/employees-onboarding.create.service.ts`）——因此這裡沒有 `employees.onboarding.errors.*`
 * 這種碼，訊息的所有權留在各自的模組，本檔只是把「這支端點可能吐出哪些碼」列成一份**契約**。
 *
 * **列出的碼有些在正常操作下不會發生：** 到職編排永遠是「先建立全新的員工，再建立它的第一筆
 * 任職／部門歸屬／扣繳設定」，因此三個子模組裡「與既有紀錄期間重疊」的錯誤在這條路徑上不會踩到
 * （一個全新員工不可能有既有任職）。**仍然列在這裡**，是因為契約要誠實：這是「這支端點吐得出的
 * 碼有哪些」，不是「正常操作下會踩到哪些」——藏起來的話，前端遇到一個「宣告清單裡沒有」的碼
 * 反而更不知道怎麼處理。
 *
 * 本檔不得 import 任何 http／elysia 模組（§3.1.1）。
 */
import { ErrorGroup, type ErrorGroupValue } from '../../../shared/service-result.ts'
// 與 `onboarding` 同屬 `employees` 大目錄，次目錄之間可以互相 import（§0.3），不必經過 index.ts。
import { EmployeeErrorCode } from '../main/employees-main.errors.ts'
import { CompanyUserErrorCode, RoleAssignmentErrorCode } from '../../company-users/index.ts'
import {
  DepartmentHistoryErrorCode,
  EmploymentErrorCode,
  JobPositionHistoryErrorCode,
  JobTitleHistoryErrorCode,
} from '../../employments/index.ts'
import { WithholdingErrorCode } from '../../withholding/index.ts'

export type OnboardingErrorDeclaration = {
  readonly code: string
  readonly group: ErrorGroupValue
  readonly httpStatus: 409 | 422
  readonly webFlowCode: '300'
}

const conflict = (code: string): OnboardingErrorDeclaration => ({
  code,
  group: ErrorGroup.Conflict,
  httpStatus: 409,
  webFlowCode: '300',
})

const unprocessable = (code: string): OnboardingErrorDeclaration => ({
  code,
  group: ErrorGroup.Unprocessable,
  httpStatus: 422,
  webFlowCode: '300',
})

/**
 * `POST /employees/onboarding/create` 可能吐出的業務錯誤碼（§1.8.3）。
 *
 * 依編排順序分組排列（員工 → 任職 → 部門歸屬 → 職稱 → 職務 → 扣繳 → 帳號 → 角色），
 * 讓「這支端點在哪一步可能失敗」一眼看得出來——這正是稽核與除錯時最常問的問題。
 */
export const ONBOARDING_ENDPOINT_ERRORS = {
  create: [
    // 員工主檔（真正會發生：建立者填的員工編號或身分證與既有員工撞了）。
    conflict(EmployeeErrorCode.CodeDuplicated),
    conflict(EmployeeErrorCode.IdentityNumberDuplicated),
    // 任職（理論上不會發生，見檔頭）。
    unprocessable(EmploymentErrorCode.EmployeeNotFound),
    unprocessable(EmploymentErrorCode.PeriodOverlap),
    conflict(EmploymentErrorCode.DuplicateHireDate),
    // 部門歸屬：DepartmentNotFound 真正會發生（建立者選了一個不存在或已刪除的部門）；其餘理論上不會。
    unprocessable(DepartmentHistoryErrorCode.EmploymentNotFound),
    unprocessable(DepartmentHistoryErrorCode.DepartmentNotFound),
    unprocessable(DepartmentHistoryErrorCode.PeriodOverlap),
    conflict(DepartmentHistoryErrorCode.DuplicateEffectiveFrom),
    // 職稱（選填，見 domain 型別註解）：JobTitleNotFound 真正會發生（選了不存在或已刪除的職稱）；
    // 其餘（同一任職既有職稱重疊）在一個全新任職上理論上不會發生。
    unprocessable(JobTitleHistoryErrorCode.EmploymentNotFound),
    unprocessable(JobTitleHistoryErrorCode.JobTitleNotFound),
    unprocessable(JobTitleHistoryErrorCode.PeriodOverlap),
    conflict(JobTitleHistoryErrorCode.DuplicateEffectiveFrom),
    // 職務（選填、可多個）：JobPositionNotFound 真正會發生；PeriodOverlap 只在同一個請求裡
    // 重複帶同一個 jobPositionId 時才會發生（見該模組 domain model 檔頭），其餘理論上不會。
    unprocessable(JobPositionHistoryErrorCode.EmploymentNotFound),
    unprocessable(JobPositionHistoryErrorCode.JobPositionNotFound),
    unprocessable(JobPositionHistoryErrorCode.PeriodOverlap),
    conflict(JobPositionHistoryErrorCode.DuplicateEffectiveFrom),
    // 扣繳設定（理論上不會發生）。
    unprocessable(WithholdingErrorCode.EmployeeNotFound),
    unprocessable(WithholdingErrorCode.PeriodOverlap),
    conflict(WithholdingErrorCode.DuplicateEffectiveFrom),
    // 登入帳號：真正會發生（`username` 全域唯一，見 `company-users-main.errors.ts`）。
    conflict(CompanyUserErrorCode.UsernameTaken),
    // 角色指派：RoleNotFound／RoleInactive 真正會發生（建立者選了不存在或已停用的角色）；
    // 其餘（成員不存在／已停用／重複指派）在一個全新建立的帳號上理論上不會發生。
    unprocessable(RoleAssignmentErrorCode.CompanyUserNotFound),
    unprocessable(RoleAssignmentErrorCode.CompanyUserInactive),
    unprocessable(RoleAssignmentErrorCode.RoleNotFound),
    unprocessable(RoleAssignmentErrorCode.RoleInactive),
    conflict(RoleAssignmentErrorCode.AlreadyAssigned),
  ],
} as const satisfies Record<string, readonly OnboardingErrorDeclaration[]>

export const describeOnboardingErrors = (declarations: readonly OnboardingErrorDeclaration[]): string =>
  declarations.length === 0
    ? '本端點不會回傳任何業務錯誤（errors 恆為空陣列）。'
    : `可能的 errors[].code（依編排順序：員工／任職／部門歸屬／扣繳／帳號／角色）：${declarations
        .map((declaration) => `${declaration.code}（HTTP ${declaration.httpStatus}／code=${declaration.webFlowCode}）`)
        .join('、')}`
