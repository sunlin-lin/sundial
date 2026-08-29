/**
 * 到職編排端點的 handler（§1.8.0）。形狀比照 `employees/main/employees-main.handler.ts`，不重述。
 *
 * **本層拿不到任何明文個資**：`createOnboarding` 回來的 `OnboardingResult.employee` 與
 * `employees/main` 其餘端點一樣，只有 `xxxMasked` 欄位（見 `employees/main/domain/
 * employee-model.ts` 檔頭），因此 §5.1「對外回應一律遮罩」在這裡同樣不是一條要記得遵守的規則。
 * 本端點的 `data` 更進一步只回識別碼與角色摘要（見 `toOnboardingData`），連遮罩後的欄位都不回
 * ——建立者剛剛才在同一個請求裡填過那些欄位，沒有必要在回應裡整包吐回去。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { OnboardingContext } from './domain/onboarding-context.ts'
import type {
  CreateOnboardingInput,
  EmploymentTypeCodeValue,
  GenderValue,
  OnboardingResult,
  WithholdingMethodCodeValue,
} from './domain/onboarding-model.ts'
import { createOnboarding } from './employees-onboarding.service.ts'

/**
 * 由組裝點注入的相依。**公司範圍與操作者都不在裡面**——兩者只能來自每一次請求的已驗證身分
 * （§4.2、稽核計畫 §5），理由與 `employees/main` 的 `EmployeesMainDependencies` 相同。
 */
export type OnboardingDependencies = Omit<OnboardingContext, 'companyId' | 'operatorCompanyUserId'>

export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('到職編排端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toOnboardingContext = (dependencies: OnboardingDependencies, identity: VerifiedIdentity): OnboardingContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
  operatorCompanyUserId: identity.companyUserId,
})

type CreateBody = {
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber: string
  readonly birthday: string
  readonly phone: string
  readonly email?: string
  readonly address: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode?: number
  readonly hireDate: string
  readonly departmentId: string
  /** 依公司設定，選填（UI 定案 §2.2）。 */
  readonly jobTitleId?: string
  /** 依公司設定，選填、可多個（UI 定案 §2.2）。沒帶這個欄位視同空陣列。 */
  readonly jobPositionIds?: readonly string[]
  readonly withholdingMethodCode: WithholdingMethodCodeValue
  readonly username: string
  readonly initialPassword: string
  readonly roleIds: readonly string[]
}

/**
 * body → service 的輸入。選填欄位一律收斂成 `null`：`exactOptionalPropertyTypes` 之下，
 * 「沒有這個欄位」與「欄位是 undefined」是兩件事，讓它在跨層傳遞時只有一種形狀
 * （理由與 `employees-main.handler.ts` 的 `toProfileInput` 相同）。`jobPositionIds` 收斂成
 * 空陣列而不是 `null`：業務型別本來就用「空陣列＝不指派」表達，不需要多一種 `null` 狀態。
 */
const toCreateInput = (body: CreateBody): CreateOnboardingInput => ({
  employeeCode: body.employeeCode,
  name: body.name,
  gender: body.gender,
  identityNumber: body.identityNumber,
  birthday: body.birthday,
  phone: body.phone,
  email: body.email ?? null,
  address: body.address,
  employmentTypeCode: body.employmentTypeCode,
  employmentNatureCode: body.employmentNatureCode ?? null,
  hireDate: body.hireDate,
  departmentId: body.departmentId,
  jobTitleId: body.jobTitleId ?? null,
  jobPositionIds: body.jobPositionIds ?? [],
  withholdingMethodCode: body.withholdingMethodCode,
  username: body.username,
  initialPassword: body.initialPassword,
  roleIds: body.roleIds,
})

/**
 * 業務資料 → 本端點的 `data`（§2、§1.8.0 的⑥）。
 *
 * **刻意只回識別碼與角色摘要，不回整包遮罩後的員工／任職／部門歸屬／扣繳明細**：建立者剛剛才
 * 在同一個請求裡送出那些欄位，畫面不需要靠這支回應把它們整包讀回去；真的需要完整明細時，
 * 前端可以拿 `employeeId` 打 `employees/main/get` 一類的既有查詢端點，不必讓這支建立端點
 * 背負「順便回全部東西」的責任（那個責任一旦背上，資料表加一個欄位就會自動出現在這支回應上）。
 */
const toOnboardingData = (result: OnboardingResult) => ({
  employeeId: result.employee.id,
  employeeCode: result.employee.employeeCode,
  employmentId: result.employment.id,
  departmentHistoryId: result.departmentHistory.id,
  /** `null`＝這次到職沒有設定職稱（`CreateOnboardingInput.jobTitleId` 為 `null`）。 */
  jobTitleHistoryId: result.jobTitleHistory === null ? null : result.jobTitleHistory.id,
  /** 空陣列＝這次到職沒有指派任何職務。 */
  jobPositionHistoryIds: result.jobPositionHistories.map((history) => history.id),
  withholdingSettingId: result.withholdingSetting.id,
  companyUserId: result.companyUserId,
  roles: result.roles.map((role) => ({
    id: role.assignmentId,
    roleId: role.roleId,
    roleCode: role.roleCode,
    roleName: role.roleName,
  })),
})

export type OnboardingData = ReturnType<typeof toOnboardingData>

export const handleOnboardingCreate = async (
  dependencies: OnboardingDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<OnboardingData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createOnboarding(toOnboardingContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toOnboardingData)
  context.set.status = outcome.status
  return outcome.body
}
