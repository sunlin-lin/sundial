/**
 * 動作可用性（前端規範 §1.3 第 (3) 類、§0.5 的 `.actions.ts`）。
 *
 * 兩種判斷混在一起，故意分成兩組函式：`canXxx(can, ...)` 是「使用者有沒有資格看到／按這個動作」
 * （權限 + 業務前置狀態），`canSubmitXxxForm(...)` 是「這個表單現在能不能送出」（必填欄位是否齊全 +
 * 是否正在送出中）。前者決定按鈕顯示或停用，後者決定送出鈕本身的 `disabled`。
 */
import type {
  BasicInfoFormState,
  DepartmentHistoryFormState,
  EmploymentCreateFormState,
  EmploymentLeaveFormState,
  JobPositionHistoryFormState,
  JobTitleHistoryFormState,
  ResetPasswordFormState,
  RoleAssignFormState,
  WithholdingCreateFormState,
} from './employees-detail.payload.ts'
import type { PermissionCode } from '../../../shared/permission/permission-code.ts'

type Can = (code: PermissionCode) => boolean

// --- §3.1 基本資料 ------------------------------------------------------------------------

export const canEditBasicInfo = (can: Can): boolean => can('employees.main.update')

export const canSubmitBasicInfoForm = (input: {
  readonly isSubmitting: boolean
  readonly form: BasicInfoFormState
}): boolean => {
  if (input.isSubmitting) return false
  const { form } = input
  return (
    form.employeeCode.trim() !== '' &&
    form.name.trim() !== '' &&
    form.gender !== '' &&
    form.identityNumber.trim() !== '' &&
    form.birthday !== '' &&
    form.phone.trim() !== '' &&
    form.address.trim() !== ''
  )
}

// --- §3.2 任職資料 ------------------------------------------------------------------------

/** 「新增任職」用於回任：目前有一段在職中的任職時不開放，否則新期間必定與既有的重疊（後端會回 `period-overlap`）。 */
export const canCreateEmployment = (can: Can, hasActiveEmployment: boolean): boolean =>
  can('employments.main.create') && !hasActiveEmployment

export const canSubmitEmploymentCreateForm = (input: {
  readonly isSubmitting: boolean
  readonly form: EmploymentCreateFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.employmentTypeCode !== 0 && input.form.hireDate !== ''
}

/** 「辦理離職」只在有一段在職中的任職時開放。 */
export const canLeaveEmployment = (can: Can, activeEmploymentId: string | null): boolean =>
  can('employments.main.leave') && activeEmploymentId !== null

export const canSubmitEmploymentLeaveForm = (input: {
  readonly isSubmitting: boolean
  readonly form: EmploymentLeaveFormState
}): boolean => {
  if (input.isSubmitting) return false
  const { form } = input
  // UI 定案 §3.2／計畫 §7：離職日、最後工作日、離職原因三缺一即錯，且最後工作日 ≤ 離職日
  // ——後兩者的關係後端也會擋（`last-working-date-after-leave-date`），這裡先做「必填」與
  // 「順序合理」兩件事，格式與其餘規則交給後端的 `300`（§6.1）。
  if (form.leaveDate === '' || form.lastWorkingDate === '' || form.leaveReasonCode === null) return false
  return form.lastWorkingDate <= form.leaveDate
}

// --- §3.3 組織資料 ------------------------------------------------------------------------

export const canCreateDepartmentHistory = (can: Can): boolean => can('employments.department-histories.create')

export const canSubmitDepartmentHistoryForm = (input: {
  readonly isSubmitting: boolean
  readonly form: DepartmentHistoryFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.departmentId !== null && input.form.effectiveFrom !== ''
}

export const canCreateJobTitleHistory = (can: Can): boolean => can('employments.job-title-histories.create')

export const canSubmitJobTitleHistoryForm = (input: {
  readonly isSubmitting: boolean
  readonly form: JobTitleHistoryFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.jobTitleId !== null && input.form.effectiveFrom !== ''
}

export const canCreateJobPositionHistory = (can: Can): boolean => can('employments.job-position-histories.create')

export const canSubmitJobPositionHistoryForm = (input: {
  readonly isSubmitting: boolean
  readonly form: JobPositionHistoryFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.jobPositionIds.length > 0 && input.form.effectiveFrom !== ''
}

// --- §3.4 扣繳 ----------------------------------------------------------------------------

export const canCreateWithholding = (can: Can): boolean => can('withholding.main.create')

export const canSubmitWithholdingCreateForm = (input: {
  readonly isSubmitting: boolean
  readonly form: WithholdingCreateFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.withholdingMethodCode !== 0 && input.form.effectiveFrom !== ''
}

// --- §3.5 帳號與角色 ----------------------------------------------------------------------

export const canAssignRole = (can: Can): boolean => can('company-users.roles.create')

export const canSubmitRoleAssignForm = (input: {
  readonly isSubmitting: boolean
  readonly form: RoleAssignFormState
}): boolean => {
  if (input.isSubmitting) return false
  return input.form.roleIds.length > 0
}

/**
 * 「移除」這顆按鈕何時可按：權限之外，還要求撤銷後至少留一個有效角色——把後端
 * `company-users.roles.errors.last-role-required` 的判定提前到畫面上（§3.3「有權限但當下狀態
 * 不允許 → 停用 ＋ tooltip 說明」）。**這不是取代後端檢查**：後端在同一筆交易內用鎖定列 ＋
 * 條件式 UPDATE 做真正的判定（`role-assignment-plan.ts` 的 `planRoleRevocation`），這裡只是不讓
 * 使用者按下一顆註定被拒絕的按鈕；兩個人同時各自嘗試撤掉對方看不到的最後一個角色時，
 * 後端仍然是唯一真正擋下來的地方（呼叫端仍然要處理後端回來的 `409`，見對應元件）。
 */
export const canRevokeRole = (can: Can, activeRoleCount: number): boolean =>
  can('company-users.roles.revoke') && activeRoleCount > 1

export const canResetPassword = (can: Can): boolean => can('company-users.main.reset-password')

/**
 * 密碼長度上下限取自 `company-users-main.routes.ts` 的 `NewPassword` schema
 * （`minLength: 8, maxLength: 128`），不是前端另訂一套（前端規範 §6.1：驗證規則必須來自
 * OpenAPI schema）。
 */
export const canSubmitResetPasswordForm = (input: {
  readonly isSubmitting: boolean
  readonly form: ResetPasswordFormState
}): boolean => {
  if (input.isSubmitting) return false
  const length = input.form.newPassword.length
  return length >= 8 && length <= 128
}
