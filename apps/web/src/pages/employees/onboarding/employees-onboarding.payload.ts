/**
 * 表單值 → `POST /employees/onboarding/create` 的送出 payload（前端規範 §1.3 第 (4) 類、
 * §0.5 的 `.payload.ts`）。
 *
 * **單頁輸入，不分步驟**（UI 定案 §2）：表單狀態是一個扁平物件，涵蓋 §2.1～§2.4 四個區塊的欄位，
 * 沒有依區塊拆成四個子物件——後端本來就是一支端點收一包扁平欄位，拆成巢狀物件在這裡只會多一層
 * 「怎麼攤平回去」的轉換，沒有換到任何好處。
 *
 * **表單驗證只做「必填」**（§6.1）：長度、格式、數值範圍一律交給後端的 `300` 回應
 * （`.errors.view.ts` 定位），不在這裡另抄一份 schema 的 `maxLength`／`pattern`／`minimum`
 * ——那正是兩套規則漂移的起點（見 `shifts-main.payload.ts` 同樣的判斷）。
 *
 * **§2.3 眷屬與勞退是 Stage 7，本頁不收這兩類欄位**：`EmployeesOnboardingCreateInput` 本來就沒有
 * 眷屬或勞退自願提繳率的欄位（後端這一輪也還沒做），扣繳只收「必填」的 `withholdingMethodCode`。
 */
import type { EmployeesOnboardingCreateInput } from '../../../api/generated/api-client.ts'

/** 表單裡幾個聯集欄位的型別，直接借用產生型別（§3.2）——後端改代碼值域時這裡當場編譯錯誤。 */
export type GenderValue = EmployeesOnboardingCreateInput['gender']
export type EmploymentTypeCodeValue = EmployeesOnboardingCreateInput['employmentTypeCode']
export type WithholdingMethodCodeValue = EmployeesOnboardingCreateInput['withholdingMethodCode']

/**
 * 三個必填的聯集欄位在表單上綁的是 `ElRadioGroup`，而它的 `modelValue` 型別解析為
 * `string | number | boolean`（不含 `undefined`，也不含 `null`——本次開發用型別探測確認過：
 * 直接綁 `GenderValue | undefined` 或 `| null` 都會被 `exactOptionalPropertyTypes` 擋下來）。
 *
 * 因此「還沒選」用**值域之外的一個哨兵值**表示，不是 `null`／`undefined`：字串欄位用 `''`
 * （空字串不是任何合法的 `GenderValue`），數字欄位用 `0`（`EmploymentTypeCodeValue` 是 1–8、
 * `WithholdingMethodCodeValue` 是 1–2，`0` 都不在值域裡）。這與 `shifts-main.payload.ts` 的
 * `WorkTypeFilter = WorkTypeCode | 0`（`0` 代表篩選器的「全部」）是同一個手法，差別只在語意：
 * 那裡的 `0` 是「不篩選」，這裡的哨兵是「使用者還沒選」，兩者都是「值域外的字面量」這個技巧。
 */
export type GenderFormValue = GenderValue | ''
export type EmploymentTypeFormValue = EmploymentTypeCodeValue | 0
export type WithholdingMethodFormValue = WithholdingMethodCodeValue | 0

export type EmployeeOnboardingFormState = {
  employeeCode: string
  name: string
  gender: GenderFormValue
  identityNumber: string
  birthday: string
  phone: string
  email: string
  address: string
  employmentTypeCode: EmploymentTypeFormValue
  /** 任職性質：選填、字典未列舉值（開放任意正整數，見後端 `employments-main.routes.ts` 註解）。
   * 綁的是 `ElInputNumber`（`modelValue` 型別收 `number | null`），未選取用 `null` 沒有型別問題。 */
  employmentNatureCode: number | null
  hireDate: string
  /** 部門／職稱綁 `ElTreeSelect`，`modelValue` 型別上收 `null`，未選取直接用 `null`。 */
  departmentId: string | null
  /** 職稱：依公司設定，選填。 */
  jobTitleId: string | null
  /** 職務：可指派多個，選填。 */
  jobPositionIds: string[]
  withholdingMethodCode: WithholdingMethodFormValue
  username: string
  /** 初始密碼：只存在於這個表單狀態與送出當下的記憶體裡，不得出現在任何 log 或錯誤訊息。 */
  initialPassword: string
  roleIds: string[]
}

export const emptyOnboardingFormState = (): EmployeeOnboardingFormState => ({
  employeeCode: '',
  name: '',
  gender: '',
  identityNumber: '',
  birthday: '',
  phone: '',
  email: '',
  address: '',
  employmentTypeCode: 0,
  employmentNatureCode: null,
  hireDate: '',
  departmentId: null,
  jobTitleId: null,
  jobPositionIds: [],
  withholdingMethodCode: 0,
  username: '',
  initialPassword: '',
  roleIds: [],
})

/**
 * 表單狀態 → 送出 payload。
 *
 * **必填欄位在這裡收斂之前，呼叫端必須先過 `canSubmitOnboardingForm`**——本函式只管「怎麼組」，
 * 不管「能不能送」，那件事的判斷在 `.actions.ts`（§1.3 的第 (3)／(4) 類分工）。
 * 呼叫端如果沒先擋，這裡對哨兵值送出的錯誤只會讓後端回一個更難懂的 `300`。
 *
 * 選填欄位一律用展開式**省略**未填的鍵，不是設成 `undefined` 或空字串／空陣列——
 * `exactOptionalPropertyTypes` 底下兩者是不同形狀，而 `jobPositionIds` 一旦帶空陣列會撞
 * schema 的 `minItems: 1`（後端把「沒有職務」表示成鍵不存在，不是空陣列）。
 */
export const toOnboardingCreatePayload = (form: EmployeeOnboardingFormState): EmployeesOnboardingCreateInput => {
  if (form.gender === '') throw new Error('gender 未選取，呼叫端必須先過 canSubmitOnboardingForm 才能送出')
  if (form.employmentTypeCode === 0)
    throw new Error('employmentTypeCode 未選取，呼叫端必須先過 canSubmitOnboardingForm 才能送出')
  if (form.departmentId === null)
    throw new Error('departmentId 未選取，呼叫端必須先過 canSubmitOnboardingForm 才能送出')
  if (form.withholdingMethodCode === 0)
    throw new Error('withholdingMethodCode 未選取，呼叫端必須先過 canSubmitOnboardingForm 才能送出')

  const email = form.email.trim()
  const jobPositionIds = form.jobPositionIds

  return {
    employeeCode: form.employeeCode.trim(),
    name: form.name.trim(),
    gender: form.gender,
    identityNumber: form.identityNumber.trim(),
    birthday: form.birthday,
    phone: form.phone.trim(),
    ...(email === '' ? {} : { email }),
    address: form.address.trim(),
    employmentTypeCode: form.employmentTypeCode,
    ...(form.employmentNatureCode === null ? {} : { employmentNatureCode: form.employmentNatureCode }),
    hireDate: form.hireDate,
    departmentId: form.departmentId,
    ...(form.jobTitleId === null ? {} : { jobTitleId: form.jobTitleId }),
    ...(jobPositionIds.length === 0 ? {} : { jobPositionIds }),
    withholdingMethodCode: form.withholdingMethodCode,
    username: form.username.trim(),
    initialPassword: form.initialPassword,
    roleIds: form.roleIds,
  }
}
