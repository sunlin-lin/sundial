/**
 * 表單值 → 各分頁各自送出的 payload（前端規範 §1.3 第 (4) 類、§0.5 的 `.payload.ts`）。
 *
 * **UI §3 定案是分頁呈現、每個分頁獨立儲存**：五個分頁各自對應一支或多支端點，
 * 因此本檔按分頁分成幾個區塊，不是單一個扁平表單物件（與 `employees-onboarding.payload.ts`
 * 「單頁一次送出」的形狀不同，理由就是分頁與單頁本來就是兩種資料流）。
 *
 * **表單驗證只做「必填」**（§6.1）：長度、格式、數值範圍交給後端的 `300` 回應
 * （`.errors.view.ts` 定位），這裡不另抄一份 schema 的 `maxLength`／`pattern`／`minimum`。
 */
import type {
  CompanyUsersMainResetPasswordInput,
  CompanyUsersRolesCreateInput,
  CompanyUsersRolesListInput,
  CompanyUsersRolesRevokeInput,
  DependentsMainCreateInput,
  DependentsMainListInput,
  DependentsMainTerminateInput,
  EmployeesMainGetData,
  EmployeesMainUpdateInput,
  EmploymentsDepartmentHistoriesCreateInput,
  EmploymentsDepartmentHistoriesListInput,
  EmploymentsJobPositionHistoriesCreateInput,
  EmploymentsJobPositionHistoriesListInput,
  EmploymentsJobTitleHistoriesCreateInput,
  EmploymentsJobTitleHistoriesListInput,
  EmploymentsMainCreateInput,
  EmploymentsMainLeaveInput,
  EmploymentsMainListInput,
  LaborPensionMainCreateInput,
  LaborPensionMainListInput,
  WithholdingMainCreateInput,
  WithholdingMainListInput,
} from '../../../api/generated/api-client.ts'

// ============================================================================================
// §3.1 基本資料
// ============================================================================================

export type GenderValue = EmployeesMainUpdateInput['gender']
/** 還沒選用值域外的哨兵值 `''`，理由與 `employees-onboarding.payload.ts` 的 `GenderFormValue` 同構。 */
export type GenderFormValue = GenderValue | ''

export type BasicInfoFormState = {
  employeeCode: string
  name: string
  gender: GenderFormValue
  identityNumber: string
  birthday: string
  phone: string
  email: string
  address: string
}

/**
 * 由 `employees.main.get` 的回應組出表單初始值。
 *
 * **`identityNumber`／`birthday`／`phone`／`email`／`address` 一律留白，不是「查得到但先不填」**：
 * `employees.main.get` 的回應只有 `identityNumberMasked`／`birthdayMasked`／`phoneMasked`／
 * `emailMasked`／`addressMasked`（遮罩過的顯示字串），`employees.main.update` 卻要求這五欄的
 * **完整值**（`identityNumber` 還要符合身分證格式的 pattern）——遮罩字串本身送不回去，兩支端點在
 * 這五欄上是不對稱的。因此表單只能預先帶出 `employeeCode`／`name`／`gender`，其餘欄位讓使用者
 * 重新完整輸入一次（即使只是想改姓名，也得連同這幾欄一起重填），畫面上以唯讀方式顯示遮罩值
 * 供對照。這是後端目前兩支端點形狀不對稱造成的限制，不是本頁刻意如此，已在交付報告回報。
 */
export const toBasicInfoFormState = (employee: EmployeesMainGetData): BasicInfoFormState => {
  if (employee === null)
    return {
      employeeCode: '',
      name: '',
      gender: '',
      identityNumber: '',
      birthday: '',
      phone: '',
      email: '',
      address: '',
    }
  return {
    employeeCode: employee.employeeCode,
    name: employee.name,
    gender: employee.gender,
    identityNumber: '',
    birthday: '',
    phone: '',
    email: '',
    address: '',
  }
}

/** 選填欄位（`email`）用展開式省略未填的鍵，`exactOptionalPropertyTypes` 底下與設成 `undefined` 是不同形狀。 */
export const toBasicInfoUpdatePayload = (id: string, form: BasicInfoFormState): EmployeesMainUpdateInput => {
  if (form.gender === '') throw new Error('gender 未選取，呼叫端必須先過 canSubmitBasicInfoForm 才能送出')

  const email = form.email.trim()

  return {
    id,
    employeeCode: form.employeeCode.trim(),
    name: form.name.trim(),
    gender: form.gender,
    identityNumber: form.identityNumber.trim(),
    birthday: form.birthday,
    phone: form.phone.trim(),
    ...(email === '' ? {} : { email }),
    address: form.address.trim(),
  }
}

// ============================================================================================
// §3.2 任職資料：新增任職（回任）
// ============================================================================================

export type EmploymentTypeCodeValue = EmploymentsMainCreateInput['employmentTypeCode']
/** 值域是 1–8，`0` 是值域外的哨兵值，理由同 `employees-onboarding.payload.ts`。 */
export type EmploymentTypeFormValue = EmploymentTypeCodeValue | 0

export type EmploymentCreateFormState = {
  employmentTypeCode: EmploymentTypeFormValue
  employmentNatureCode: number | null
  hireDate: string
}

export const emptyEmploymentCreateFormState = (): EmploymentCreateFormState => ({
  employmentTypeCode: 0,
  employmentNatureCode: null,
  hireDate: '',
})

export const toEmploymentCreatePayload = (
  employeeId: string,
  form: EmploymentCreateFormState,
): EmploymentsMainCreateInput => {
  if (form.employmentTypeCode === 0)
    throw new Error('employmentTypeCode 未選取，呼叫端必須先過 canSubmitEmploymentCreateForm 才能送出')

  return {
    employeeId,
    employmentTypeCode: form.employmentTypeCode,
    ...(form.employmentNatureCode === null ? {} : { employmentNatureCode: form.employmentNatureCode }),
    hireDate: form.hireDate,
  }
}

// ============================================================================================
// §3.2 任職資料：辦理離職
// ============================================================================================

export type EmploymentLeaveFormState = {
  leaveDate: string
  lastWorkingDate: string
  leaveReasonCode: number | null
}

export const emptyEmploymentLeaveFormState = (): EmploymentLeaveFormState => ({
  leaveDate: '',
  lastWorkingDate: '',
  leaveReasonCode: null,
})

export const toEmploymentLeavePayload = (
  employmentId: string,
  form: EmploymentLeaveFormState,
): EmploymentsMainLeaveInput => {
  if (form.leaveReasonCode === null)
    throw new Error('leaveReasonCode 未填，呼叫端必須先過 canSubmitEmploymentLeaveForm 才能送出')

  return {
    id: employmentId,
    leaveDate: form.leaveDate,
    lastWorkingDate: form.lastWorkingDate,
    leaveReasonCode: form.leaveReasonCode,
  }
}

// ============================================================================================
// §3.3 組織資料：部門異動
// ============================================================================================

export type DepartmentHistoryFormState = {
  departmentId: string | null
  effectiveFrom: string
  /** 空字串代表沒有結束日（開放式期間），送出時整個鍵省略，不是送空字串（後端要求日期格式）。 */
  effectiveTo: string
}

export const emptyDepartmentHistoryFormState = (): DepartmentHistoryFormState => ({
  departmentId: null,
  effectiveFrom: '',
  effectiveTo: '',
})

export const toDepartmentHistoryPayload = (
  employmentId: string,
  form: DepartmentHistoryFormState,
): EmploymentsDepartmentHistoriesCreateInput => {
  if (form.departmentId === null)
    throw new Error('departmentId 未選取，呼叫端必須先過 canSubmitDepartmentHistoryForm 才能送出')

  return {
    employmentId,
    departmentId: form.departmentId,
    effectiveFrom: form.effectiveFrom,
    ...(form.effectiveTo === '' ? {} : { effectiveTo: form.effectiveTo }),
  }
}

// ============================================================================================
// §3.3 組織資料：職稱異動
// ============================================================================================

export type JobTitleHistoryFormState = {
  jobTitleId: string | null
  effectiveFrom: string
  effectiveTo: string
}

export const emptyJobTitleHistoryFormState = (): JobTitleHistoryFormState => ({
  jobTitleId: null,
  effectiveFrom: '',
  effectiveTo: '',
})

export const toJobTitleHistoryPayload = (
  employmentId: string,
  form: JobTitleHistoryFormState,
): EmploymentsJobTitleHistoriesCreateInput => {
  if (form.jobTitleId === null)
    throw new Error('jobTitleId 未選取，呼叫端必須先過 canSubmitJobTitleHistoryForm 才能送出')

  return {
    employmentId,
    jobTitleId: form.jobTitleId,
    effectiveFrom: form.effectiveFrom,
    ...(form.effectiveTo === '' ? {} : { effectiveTo: form.effectiveTo }),
  }
}

// ============================================================================================
// §3.3 組織資料：職務異動（可同時指派多個）
// ============================================================================================

export type JobPositionHistoryFormState = {
  jobPositionIds: string[]
  effectiveFrom: string
  effectiveTo: string
}

export const emptyJobPositionHistoryFormState = (): JobPositionHistoryFormState => ({
  jobPositionIds: [],
  effectiveFrom: '',
  effectiveTo: '',
})

export const toJobPositionHistoryPayload = (
  employmentId: string,
  form: JobPositionHistoryFormState,
): EmploymentsJobPositionHistoriesCreateInput => {
  if (form.jobPositionIds.length === 0)
    throw new Error('jobPositionIds 未選取，呼叫端必須先過 canSubmitJobPositionHistoryForm 才能送出')

  return {
    employmentId,
    jobPositionIds: form.jobPositionIds,
    effectiveFrom: form.effectiveFrom,
    ...(form.effectiveTo === '' ? {} : { effectiveTo: form.effectiveTo }),
  }
}

// ============================================================================================
// §3.4 扣繳
// ============================================================================================

export type WithholdingMethodCodeValue = WithholdingMainCreateInput['withholdingMethodCode']
/** 值域是 1–2，`0` 是值域外的哨兵值，理由同上。 */
export type WithholdingMethodFormValue = WithholdingMethodCodeValue | 0

export type WithholdingCreateFormState = {
  withholdingMethodCode: WithholdingMethodFormValue
  effectiveFrom: string
  effectiveTo: string
}

export const emptyWithholdingCreateFormState = (): WithholdingCreateFormState => ({
  withholdingMethodCode: 0,
  effectiveFrom: '',
  effectiveTo: '',
})

export const toWithholdingCreatePayload = (
  employeeId: string,
  form: WithholdingCreateFormState,
): WithholdingMainCreateInput => {
  if (form.withholdingMethodCode === 0)
    throw new Error('withholdingMethodCode 未選取，呼叫端必須先過 canSubmitWithholdingCreateForm 才能送出')

  return {
    employeeId,
    withholdingMethodCode: form.withholdingMethodCode,
    effectiveFrom: form.effectiveFrom,
    ...(form.effectiveTo === '' ? {} : { effectiveTo: form.effectiveTo }),
  }
}

// ============================================================================================
// §3.4 眷屬（計畫 05 Stage 7）
// ============================================================================================

export type RelationshipCodeValue = DependentsMainCreateInput['relationshipCode']
/** 值域是 1–8，`0` 是值域外的哨兵值，理由同上（必填但預設未選）。 */
export type RelationshipCodeFormValue = RelationshipCodeValue | 0

export type DependentCreateFormState = {
  name: string
  identityNumber: string
  birthday: string
  relationshipCode: RelationshipCodeFormValue
  isStudent: boolean
  isDisabled: boolean
  isUnableToWork: boolean
  isCohabiting: boolean
  effectiveDate: string
}

export const emptyDependentCreateFormState = (): DependentCreateFormState => ({
  name: '',
  identityNumber: '',
  birthday: '',
  relationshipCode: 0,
  isStudent: false,
  isDisabled: false,
  isUnableToWork: false,
  isCohabiting: false,
  effectiveDate: '',
})

export const toDependentCreatePayload = (
  employeeId: string,
  form: DependentCreateFormState,
): DependentsMainCreateInput => {
  if (form.relationshipCode === 0)
    throw new Error('relationshipCode 未選取，呼叫端必須先過 canSubmitDependentCreateForm 才能送出')

  return {
    employeeId,
    name: form.name.trim(),
    identityNumber: form.identityNumber.trim(),
    birthday: form.birthday,
    relationshipCode: form.relationshipCode,
    isStudent: form.isStudent,
    isDisabled: form.isDisabled,
    isUnableToWork: form.isUnableToWork,
    isCohabiting: form.isCohabiting,
    effectiveDate: form.effectiveDate,
  }
}

/**
 * 「終止扶養」：畫面上只有一個 `endDate` 欄位，理由與 `EmploymentLeaveDialog.vue` 同構——
 * 終止是動作類端點（`dependents.main.terminate`），不是把整份眷屬資料改一輪的 update。
 */
export type DependentTerminateFormState = { endDate: string }

export const emptyDependentTerminateFormState = (): DependentTerminateFormState => ({ endDate: '' })

export const toDependentTerminatePayload = (
  id: string,
  form: DependentTerminateFormState,
): DependentsMainTerminateInput => ({ id, endDate: form.endDate })

// ============================================================================================
// §3.4 勞退自願提繳率（計畫 05 Stage 7）
// ============================================================================================

/**
 * **`voluntaryContributionRate` 全程是字串，不經過 `number`**（前端規範：decimal 字串禁止
 * `Number()`／`parseFloat` 一類轉型，`check:number-cast` 會擋）。表單欄位是純文字輸入
 * （`ElInput`，不是 `ElInputNumber`），格式（後端 pattern `^[0-9]\.[0-9]{4}$`）交給後端的
 * `300` 回應把關，這裡跟本頁其餘表單一樣只做「必填」（§6.1，見本檔檔頭）。
 */
export type LaborPensionCreateFormState = {
  voluntaryContributionRate: string
  effectiveFrom: string
  effectiveTo: string
}

export const emptyLaborPensionCreateFormState = (): LaborPensionCreateFormState => ({
  voluntaryContributionRate: '',
  effectiveFrom: '',
  effectiveTo: '',
})

export const toLaborPensionCreatePayload = (
  employeeId: string,
  form: LaborPensionCreateFormState,
): LaborPensionMainCreateInput => ({
  employeeId,
  voluntaryContributionRate: form.voluntaryContributionRate.trim(),
  effectiveFrom: form.effectiveFrom,
  ...(form.effectiveTo === '' ? {} : { effectiveTo: form.effectiveTo }),
})

// ============================================================================================
// 列表查詢（§7.1 統一欄位名 ＋ §7.3 回聲比對用的查詢型別，形狀比照 `employees-main.payload.ts`
// 的 `EmployeeListQuery`）
// ============================================================================================

export const EMPLOYMENT_LIST_PER_PAGE = 20
/** 與後端 `DEFAULT_EMPLOYMENT_SORT`（`employment-list-view.ts`）一致：到職日新到舊。 */
export const EMPLOYMENT_LIST_SORT = { field: 'hireDate', order: 'desc' } as const

export type EmploymentListQuery = EmploymentsMainListInput & { readonly sort: typeof EMPLOYMENT_LIST_SORT }

export const toEmploymentListQuery = (employeeId: string, currentPage: number): EmploymentListQuery => ({
  employeeId,
  currentPage,
  perPage: EMPLOYMENT_LIST_PER_PAGE,
  sort: EMPLOYMENT_LIST_SORT,
})

/**
 * 部門／職稱／職務／扣繳四支「歷史清單」端點的 request schema 都不收 `sort`——後端一律固定
 * 依 `effectiveFrom` 由舊到新排序並原樣回聲這個常數（各自 `*.handler.ts` 的 `toListData`）。
 * `isListEcho` 比對回聲時需要查詢端也帶著這個值，因此這裡補一個編譯期常數，不是送給後端的欄位
 * ——四支端點的 request body 送出時完全沒有 `sort` 這個鍵（型別上 `XxxListInput` 也沒有這個欄位）。
 */
export const HISTORY_LIST_SORT_ECHO = { field: 'effectiveFrom', order: 'asc' } as const

export const HISTORY_LIST_PER_PAGE = 20

export type DepartmentHistoryListQuery = EmploymentsDepartmentHistoriesListInput & {
  readonly sort: typeof HISTORY_LIST_SORT_ECHO
}

export const toDepartmentHistoryListQuery = (
  employmentId: string,
  currentPage: number,
): DepartmentHistoryListQuery => ({
  employmentId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: HISTORY_LIST_SORT_ECHO,
})

export type JobTitleHistoryListQuery = EmploymentsJobTitleHistoriesListInput & {
  readonly sort: typeof HISTORY_LIST_SORT_ECHO
}

export const toJobTitleHistoryListQuery = (employmentId: string, currentPage: number): JobTitleHistoryListQuery => ({
  employmentId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: HISTORY_LIST_SORT_ECHO,
})

export type JobPositionHistoryListQuery = EmploymentsJobPositionHistoriesListInput & {
  readonly sort: typeof HISTORY_LIST_SORT_ECHO
}

export const toJobPositionHistoryListQuery = (
  employmentId: string,
  currentPage: number,
): JobPositionHistoryListQuery => ({
  employmentId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: HISTORY_LIST_SORT_ECHO,
})

export type WithholdingListQuery = WithholdingMainListInput & { readonly sort: typeof HISTORY_LIST_SORT_ECHO }

export const toWithholdingListQuery = (employeeId: string, currentPage: number): WithholdingListQuery => ({
  employeeId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: HISTORY_LIST_SORT_ECHO,
})

/**
 * 眷屬清單固定依 `effectiveDate` 由舊到新排序並原樣回聲（`dependents-main.handler.ts` 的
 * `toListData`）——欄位名是 `effectiveDate` 不是 `effectiveFrom`，與扣繳／勞退／組織異動三支
 * 「歷史清單」端點不同構，因此另立一個常數，不能誤用 `HISTORY_LIST_SORT_ECHO`。
 */
export const DEPENDENT_LIST_SORT_ECHO = { field: 'effectiveDate', order: 'asc' } as const

export type DependentListQuery = DependentsMainListInput & { readonly sort: typeof DEPENDENT_LIST_SORT_ECHO }

export const toDependentListQuery = (employeeId: string, currentPage: number): DependentListQuery => ({
  employeeId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: DEPENDENT_LIST_SORT_ECHO,
})

/** 勞退清單固定依 `effectiveFrom` 由舊到新排序（`labor-pension-main.handler.ts`），與扣繳同構。 */
export type LaborPensionListQuery = LaborPensionMainListInput & { readonly sort: typeof HISTORY_LIST_SORT_ECHO }

export const toLaborPensionListQuery = (employeeId: string, currentPage: number): LaborPensionListQuery => ({
  employeeId,
  currentPage,
  perPage: HISTORY_LIST_PER_PAGE,
  sort: HISTORY_LIST_SORT_ECHO,
})

// ============================================================================================
// §3.5 帳號與角色：新增角色
// ============================================================================================

export type RoleAssignFormState = { roleIds: string[] }

export const emptyRoleAssignFormState = (): RoleAssignFormState => ({ roleIds: [] })

export const toRoleAssignPayload = (companyUserId: string, form: RoleAssignFormState): CompanyUsersRolesCreateInput => {
  if (form.roleIds.length === 0) throw new Error('roleIds 未選取，呼叫端必須先過 canSubmitRoleAssignForm 才能送出')

  return { companyUserId, roleIds: form.roleIds }
}

// ============================================================================================
// §3.5 帳號與角色：移除角色
// ============================================================================================

/**
 * 撤銷一個角色。**這裡沒有表單狀態**：畫面是角色清單裡逐列的「移除」按鈕，不是一份使用者填寫的
 * 表單，直接由那一列的 `roleId` 組 payload 即可，理由與 `toEmploymentLeavePayload` 之類「表單值
 * → payload」的其餘函式不同構——沒有值需要轉換，只是把呼叫端已經知道的兩個 id 包成請求形狀。
 */
export const toRoleRevokePayload = (companyUserId: string, roleId: string): CompanyUsersRolesRevokeInput => ({
  companyUserId,
  roleIds: [roleId],
})

// ============================================================================================
// §3.5 帳號與角色：重設密碼
// ============================================================================================

export type ResetPasswordFormState = { newPassword: string }

export const emptyResetPasswordFormState = (): ResetPasswordFormState => ({ newPassword: '' })

export const toResetPasswordPayload = (
  companyUserId: string,
  form: ResetPasswordFormState,
): CompanyUsersMainResetPasswordInput => ({ companyUserId, newPassword: form.newPassword })

// ============================================================================================
// §3.5 帳號與角色：角色指派清單查詢
// ============================================================================================

export const ROLE_ASSIGNMENT_LIST_PER_PAGE = 20
/** 與後端 `DEFAULT_ASSIGNMENT_SORT`（`role-assignment-sort.ts`）一致：最近指派的排前面。 */
export const ROLE_ASSIGNMENT_LIST_SORT = { field: 'assignedAt', order: 'desc' } as const

export type RoleAssignmentListQuery = CompanyUsersRolesListInput & { readonly sort: typeof ROLE_ASSIGNMENT_LIST_SORT }

/** 只查這個帳號未撤銷的指派——已撤銷的歷史不在這個分頁的畫面範圍內（沒有畫面會用到）。 */
export const toRoleAssignmentListQuery = (companyUserId: string, currentPage: number): RoleAssignmentListQuery => ({
  companyUserId,
  includeRevoked: false,
  currentPage,
  perPage: ROLE_ASSIGNMENT_LIST_PER_PAGE,
  sort: ROLE_ASSIGNMENT_LIST_SORT,
})
