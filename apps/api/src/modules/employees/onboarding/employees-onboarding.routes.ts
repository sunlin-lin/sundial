/**
 * 到職編排的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * **只有一支端點**：`create`。UI 定案（`docs/ui/20-employee-list.md` §1、§2）「新增員工採單頁
 * 輸入，不分步驟，一次建立員工、任職、組織關係、登入帳號及角色」——沒有「修改」「查詢」，
 * 那些分別是 `employees/main`、`employments/main` 等既有端點的事，本次目錄只負責「一次建立」
 * 這一種動作，也因此次目錄名是 `onboarding`（到職這件事），不是與大目錄同名的 `main`
 * （計畫 §4.1：子實體是「到職這件事」，不是「員工」）。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import { BaseRequest, codeField, IsoDate, Nullable, Uuid } from '../../../shared/field-schemas.ts'
import { describeOnboardingErrors, ONBOARDING_ENDPOINT_ERRORS } from './employees-onboarding.errors.ts'
import { handleOnboardingCreate, type OnboardingDependencies } from './employees-onboarding.handler.ts'

/** 員工編號。長度上限對齊 `employees.employee_code`（見 `employees-main.routes.ts` 的 `EmployeeCode`）。 */
const EmployeeCode = codeField(64)

const EmployeeName = t.String({ minLength: 1, maxLength: 128 })

const GenderSchema = t.Union([t.Literal('MALE'), t.Literal('FEMALE')])

/** 身分證字號樣式與理由：見 `employees-main.routes.ts` 的 `IdentityNumber`，逐字相同。 */
const IdentityNumber = t.String({ pattern: '^[A-Za-z][A-Za-z0-9]\\d{8}$' })

const Phone = t.String({ minLength: 1, maxLength: 32, pattern: '^[0-9+\\-() ]+$' })

const Email = t.String({ minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' })

const Address = t.String({ minLength: 1, maxLength: 255 })

/**
 * 僱用型態代碼。值必須與 `db/schema/employee-employments.ts` 的 `EmploymentTypeCode` 相同
 * （見 `employments-main.routes.ts` 的 `EmploymentTypeCodeSchema`，逐字相同）。
 */
const EmploymentTypeCodeSchema = t.Union([1, 2, 3, 4, 5, 6, 7, 8].map((value) => t.Literal(value)))

/** 任職性質代碼：字典未列舉值，開放任意正整數（見 `employments-main.routes.ts` 的 `OpenCode`）。 */
const OpenCode = t.Integer({ minimum: 1 })

/**
 * 扣繳方式代碼。值必須與 `db/schema/employee-withholding-settings.ts` 的 `WithholdingMethodCode`
 * 相同（見 `withholding-main.routes.ts`，逐字相同）：1 薪資所得扣繳稅額表、2 固定 5%。
 */
const WithholdingMethodCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/**
 * 登入帳號。上限對齊 `users.username` 的 `VARCHAR(64)`。
 *
 * 不套用 `codeField` 的正則：帳號習慣上會含 `.`／`@` 這類 `codeField` 不允許的字元
 * （例如 email 格式的帳號），而 `users.username` 資料字典上就只是「登入帳號，全域唯一」，
 * 沒有註明格式限制。
 */
const Username = t.String({ minLength: 1, maxLength: 64 })

/**
 * 初始密碼。
 *
 * **`minLength: 8` 是本次新增的暫定門檻，不是既有定案**——後端規範 §9 第 3 項明寫「密碼複雜度
 * 尚未定案」。完全不設下限會讓建立者填一個空字串或一個字元的密碼，那比暫定一個常見的最小長度
 * 風險更高；上限 128 只是防止異常大的輸入撐爆 Argon2id 的雜湊時間，不是安全考量。
 * **這一項請在回報中特別確認**，正式的密碼複雜度政策定案後應回來調整這裡。
 */
const InitialPassword = t.String({ minLength: 8, maxLength: 128 })

/** 角色 id 清單。上限與去重規則抄 `company-users/roles/company-users-roles.routes.ts` 的 `RoleIds`。 */
const MAX_ROLE_IDS = 50
const RoleIds = t.Array(Uuid, { minItems: 1, maxItems: MAX_ROLE_IDS, uniqueItems: true })

/**
 * 職務 id 清單。選填，可多個（UI 定案 §2.2）。上限比照
 * `employments/job-position-histories` 端點的 `JobPositionIds`。
 */
const MAX_JOB_POSITION_IDS = 50
const JobPositionIds = t.Array(Uuid, { minItems: 1, maxItems: MAX_JOB_POSITION_IDS, uniqueItems: true })

const OnboardingResultSchema = t.Object({
  employeeId: Uuid,
  employeeCode: EmployeeCode,
  employmentId: Uuid,
  departmentHistoryId: Uuid,
  jobTitleHistoryId: Nullable(Uuid),
  jobPositionHistoryIds: t.Array(Uuid),
  withholdingSettingId: Uuid,
  companyUserId: Uuid,
  roles: t.Array(t.Object({ id: Uuid, roleId: Uuid, roleCode: t.String(), roleName: t.String() })),
})

const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 到職編排的端點。
 *
 * @param dependencies 由組裝點注入的資料庫、欄位加解密器（給 `employees/main` 用）與 clock。
 *   **不在模組層建立連線或讀金鑰**（§1.7）。
 */
export const employeesOnboardingRoutes = (dependencies: OnboardingDependencies) =>
  new Elysia({ name: 'employees-onboarding-routes' })
    .use(requestContext)
    .post('/employees/onboarding/create', (context) => handleOnboardingCreate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employees.onboarding.create'),
        // ---- 基本資料 ----
        employeeCode: EmployeeCode,
        name: EmployeeName,
        gender: GenderSchema,
        identityNumber: IdentityNumber,
        birthday: IsoDate,
        phone: Phone,
        email: t.Optional(Email),
        address: Address,
        // ---- 任職與組織 ----
        employmentTypeCode: EmploymentTypeCodeSchema,
        employmentNatureCode: t.Optional(OpenCode),
        hireDate: IsoDate,
        departmentId: Uuid,
        // ---- 職稱／職務（依公司設定，選填，見 domain/onboarding-model.ts 的型別註解） ----
        jobTitleId: t.Optional(Uuid),
        jobPositionIds: t.Optional(JobPositionIds),
        // ---- 扣繳（生效日固定＝到職日，見 domain/onboarding-model.ts 的型別註解） ----
        withholdingMethodCode: WithholdingMethodCodeSchema,
        // ---- 登入帳號與角色 ----
        username: Username,
        initialPassword: InitialPassword,
        roleIds: RoleIds,
      }),
      response: {
        200: envelope(OnboardingResultSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary:
          '新增員工（到職）：單一交易內建立員工、任職、部門歸屬、職稱、職務、扣繳設定、登入帳號及角色（職稱／職務依公司設定，選填）',
        description: `${describeOnboardingErrors(ONBOARDING_ENDPOINT_ERRORS.create)} 任一步失敗，整筆取消（UI 定案 docs/ui/20-employee-list.md §2.4）。`,
      },
    })
