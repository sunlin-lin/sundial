/**
 * 到職編排的業務型別（service ↔ repository 之間傳遞的形狀）。本目錄一律零 IO（§0.1、§3.1.1）。
 *
 * **本檔匯入其他大目錄的型別一律經由對方的 `index.ts`**（§0.3）：`EmploymentDetail`／
 * `DepartmentHistoryDetail`／`JobTitleHistoryDetail`／`JobPositionHistoryDetail` 來自
 * `employments`，`WithholdingSettingDetail` 來自 `withholding`，`AssignedRole` 來自
 * `company-users`。唯一的例外是 `EmployeeDetail`——它與 `onboarding` 同屬 `employees` 這個
 * 大目錄，次目錄之間本來就可以互相 import（§0.3：「同一大目錄內的次目錄之間可以互相 import」），
 * 因此直接指向 `main/domain/employee-model.ts`。
 */
export type { EmploymentTypeCodeValue, GenderValue, WithholdingMethodCodeValue } from '../../../../db/schema/index.ts'

import type { EmploymentTypeCodeValue, GenderValue, WithholdingMethodCodeValue } from '../../../../db/schema/index.ts'
import type { EmployeeDetail } from '../../main/domain/employee-model.ts'
import type { AssignedRole } from '../../../company-users/index.ts'
import type {
  DepartmentHistoryDetail,
  EmploymentDetail,
  JobPositionHistoryDetail,
  JobTitleHistoryDetail,
} from '../../../employments/index.ts'
import type { WithholdingSettingDetail } from '../../../withholding/index.ts'

export type {
  AssignedRole,
  DepartmentHistoryDetail,
  EmployeeDetail,
  EmploymentDetail,
  JobPositionHistoryDetail,
  JobTitleHistoryDetail,
  WithholdingSettingDetail,
}

/**
 * 建立到職的完整輸入。**單頁一次收齊**（UI 定案 `docs/ui/20-employee-list.md` §1、§2）：
 * 員工基本資料、任職與組織、登入帳號與角色，四段攤平在同一個型別裡，不分步驟。
 *
 * **職稱／職務依公司設定，非必填**（UI 定案 §2.2：「職稱——依公司設定」「職務——依公司設定，
 * 可指派多個職務」；計畫 §3.2：「可做成非必填」）——`jobTitleId` 為 `null` 代表這次到職不設定
 * 職稱，`jobPositionIds` 為空陣列代表不指派任何職務，兩者都合法。
 *
 * 刻意**沒有**眷屬、勞退自願提繳率——這兩項依實作計畫 §8 屬於 Stage 7，UI 定案也明說眷屬可以
 * 「建立員工後補登」，不在本輪範圍內。
 */
export type CreateOnboardingInput = {
  // ---- 基本資料（→ employees.main.create） ----
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber: string
  readonly birthday: string
  readonly phone: string
  readonly email: string | null
  readonly address: string

  // ---- 任職與組織（→ employments.main.create、employments.department-histories.create） ----
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode: number | null
  readonly hireDate: string
  readonly departmentId: string

  // ---- 職稱／職務（→ employments.job-title-histories.create、
  // employments.job-position-histories.create；依公司設定，非必填，見上方檔頭） ----
  /** `null`＝這次到職不設定職稱。生效日固定＝到職日，理由與部門歸屬、扣繳設定相同。 */
  readonly jobTitleId: string | null
  /** 空陣列＝不指派任何職務。生效日固定＝到職日。 */
  readonly jobPositionIds: readonly string[]

  // ---- 扣繳（→ withholding.main.create）----
  /**
   * 生效日**固定等於到職日**，不另外收一個欄位：UI 定案（§2.3）只要求「薪資扣繳方式必填」，
   * 沒有要求建立者另外填一個生效日——一個尚未到職的人不會有生效中的扣繳設定，
   * 到職當天生效是唯一合理的預設值，多問一個欄位只是多一個使用者要填、系統要驗證「是不是
   * 早於到職日」的欄位。日後在「修改員工」頁改扣繳方式時才需要獨立的生效日（那是 Stage 6 的事）。
   */
  readonly withholdingMethodCode: WithholdingMethodCodeValue

  // ---- 登入帳號與角色（→ company-users.main.create、company-users.roles.create） ----
  readonly username: string
  /** 明文，只在請求的呼叫堆疊上短暫存在，往下第一步就變成 hash（§5.1）。 */
  readonly initialPassword: string
  /** 至少一筆，由 request schema 的 `minItems: 1` 保證（UI §2.4：「建立帳號時至少指派一個角色」）。 */
  readonly roleIds: readonly string[]
}

/** 一次到職編排完成後的完整結果。 */
export type OnboardingResult = {
  readonly employee: EmployeeDetail
  readonly employment: EmploymentDetail
  readonly departmentHistory: DepartmentHistoryDetail
  /** `null`＝這次到職沒有設定職稱（`CreateOnboardingInput.jobTitleId` 為 `null`）。 */
  readonly jobTitleHistory: JobTitleHistoryDetail | null
  /** 空陣列＝這次到職沒有指派任何職務。 */
  readonly jobPositionHistories: readonly JobPositionHistoryDetail[]
  readonly withholdingSetting: WithholdingSettingDetail
  readonly companyUserId: string
  readonly roles: readonly AssignedRole[]
}
