/**
 * 員工主檔的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。寫在每支端點上就是把同一件事抄 N 遍，
 * 而漏抄的那一支不會報錯、不會少一個檔案，它只是**變成不驗證身分**。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換（`/employees/main/list` →
 * `employees.main.list`），由身分驗證 middleware 自己推導。
 *
 * **對外的個資欄位一律是 `xxxMasked`**（§5.1）：本模組的 response schema 裡沒有
 * `identityNumber`／`birthday`／`phone`／`email`／`address` 任何一個未遮罩的名字，
 * 而且不是「這裡記得改名字」——service 回來的型別上就沒有明文（見 `domain/employee-model.ts`）。
 *
 * **沒有 `create`，這是破壞性變更**（實作計畫 `05-employee-onboarding.md` §4.2 定案）：
 * 單頁新增員工上線後，系統會有兩條建立員工的路，其中一條（原本的 `/employees/main/create`）
 * 只建人員主檔、不建任職與帳號——會產生「沒有任職、沒有帳號」的員工，而畫面上顯示成一列正常的
 * 資料。新增員工唯一的路現在是 `/employees/onboarding/create`（`modules/employees/onboarding/`）。
 * 業務動作 `createEmployeeInTransaction` 保留在 `employees-main.service.ts`，只被那支端點呼叫
 * （§0.4：沒有端點的業務動作一樣放入口檔）；權限碼 `employees.main.create` 已在
 * `drizzle/0027_onboarding_permission_codes.sql` 停用（`status = 'INACTIVE'`，不刪除那一列，
 * 理由見該 migration 檔頭）。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  codeField,
  IsoDate,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
  Uuid,
} from '../../../shared/field-schemas.ts'
import { EMPLOYEE_SORT_FIELDS } from './domain/employee-list-view.ts'
import {
  handleEmployeeDelete,
  handleEmployeeGet,
  handleEmployeeList,
  handleEmployeeUpdate,
  type EmployeesMainDependencies,
} from './employees-main.handler.ts'
import { describeEmployeeErrors, EMPLOYEE_ENDPOINT_ERRORS } from './employees-main.errors.ts'

/**
 * 員工編號。字元格式與長度上限說明見 {@link codeField}——長度對齊
 * `employees.employee_code` 的 `VARCHAR(64)`。
 */
const EmployeeCode = codeField(64)

/** 員工姓名。長度上限對齊 `employees.name` 的 `VARCHAR(128)`。 */
const EmployeeName = t.String({ minLength: 1, maxLength: 128 })

/**
 * 性別代碼，聯集字面值（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.String()`）。
 *
 * 值必須與 `db/schema/employees.ts` 的 `Gender` 相同。**兩邊不一致時會編譯失敗**——
 * handler 收的是 `GenderValue`，這裡多一個或少一個字面值，路由的委派呼叫當場對不上型別。
 * 不直接 import 那個常數，是為了讓路由層不相依資料庫 schema。
 */
const GenderSchema = t.Union([t.Literal('MALE'), t.Literal('FEMALE')])

/**
 * 身分證字號（含居留證統一證號）。
 *
 * 樣式 `^[A-Za-z][A-Za-z0-9]\d{8}$` 同時涵蓋三種在台灣會實際遇到的格式：
 * 國民身分證（`A123456789`）、2021 年起的新式居留證統號（`A800000014`）、
 * 舊式居留證（`AB12345678`）。**刻意不驗檢查碼**：舊式居留證的檢查碼規則與國民身分證不同，
 * 一套規則會把另一套的合法號碼擋在門外，而被擋的人沒有任何替代輸入方式。
 *
 * 大小寫都收，寫入前由 `normalizeIdentityNumber` 統一轉大寫——否則同一個人用不同大小寫
 * 會算出兩個 blind index，唯一鍵一次也擋不到。
 */
const IdentityNumber = t.String({ pattern: '^[A-Za-z][A-Za-z0-9]\\d{8}$' })

/**
 * 電話。允許數字、`+`、`-`、空白與括號（國碼、分機、市話的常見寫法）。
 *
 * 不做更嚴格的格式驗證：台灣的市話、手機、國際號碼與分機沒有一套涵蓋全部的格式，
 * 而擋錯的代價是「這個人的電話存不進系統」，收寬的代價只是資料整齊度。
 */
const Phone = t.String({ minLength: 1, maxLength: 32, pattern: '^[0-9+\\-() ]+$' })

/**
 * Email。上限 254 是 RFC 5321 的位址長度上限，與 `email_encrypted` 的明文預算一致。
 *
 * 用 `format` 之外再加一個最低限度的樣式：只確認「有一個 `@`、兩邊都不是空的、網域含一個點」。
 * 完整的 RFC 5322 驗證會擋掉一堆實際存在的合法位址，而真正能確認 Email 有效的方式只有寄信。
 */
const Email = t.String({ minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' })

/** 地址。上限 255 個字元，與 `address_encrypted` 的明文預算一致。 */
const Address = t.String({ minLength: 1, maxLength: 255 })

/**
 * 列表的關鍵字。
 *
 * **只比對員工編號與姓名**——身分證等其餘個資欄位刻意不開放模糊搜尋（理由見
 * `impl/employees-main.list.repository.ts` 的 `buildConditions`）。上限對齊姓名的長度上限，
 * 超過就不可能命中任何資料。
 */
const EmployeeKeyword = t.String({ maxLength: 128 })

/** 遮罩後的敏感欄位。刻意用寬鬆的字串型別：遮罩結果含 `*`，套原欄位的樣式驗證會失敗。 */
const MaskedValue = t.String()

/**
 * 僱用型態代碼，聯集字面值。值必須與 `db/schema/employee-employments.ts` 的 `EmploymentTypeCode`
 * 相同（1 正職、2 兼職、3 約聘、4 派遣、5 工讀、6 臨時、7 顧問、8 實習）。
 */
const EmploymentTypeCodeSchema = t.Union([
  t.Literal(1),
  t.Literal(2),
  t.Literal(3),
  t.Literal(4),
  t.Literal(5),
  t.Literal(6),
  t.Literal(7),
  t.Literal(8),
])

/** 任職狀態代碼，值必須與 `db/schema/employee-employments.ts` 的 `EmploymentStatus` 相同。 */
const EmploymentStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('LEFT')])

/** 帳號狀態代碼，值必須與 `db/schema/company-users.ts` 的 `CompanyUserStatus` 相同。 */
const AccountStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')])

/**
 * 列表單筆。**多六欄**（目前有效職稱、部門、僱用類型、到職日、任職狀態、帳號狀態，UI 定案
 * `docs/ui/20-employee-list.md` §1，計畫 §3.2；Stage 5／本輪陸續接上）：`null` 代表這位員工
 * 目前沒有這項資料（未設定職稱／部門、從未建立任職、沒有登入帳號），不是查詢失敗。
 *
 * **除 `jobTitleName` 外的五欄用 `t.Optional` 包一層，本端點實際上每次都會回它們**（handler
 * 沒有任何分支會省略）。這麼寫是相容性的刻意選擇，不是欄位真的會缺席：`apps/web` 既有的
 * `employees-main.view.ts` 是在這五欄還不存在時寫的，它的型別（`EmployeesMainListData`）
 * 由本檔案機械產生，若這裡直接宣告成必填，`bun run gen:api` 產生的型別就會要求那個既有頁面
 * 的每一處測試 fixture 都補齊這五欄——那是前端 Stage 6 的工作範圍（`apps/web/**`），本輪職責
 * 只到「後端把資料生出來、且新欄位在契約上是相容的加法」為止（§1.6：加值、不刪值）。
 */
const EmployeeSummarySchema = t.Object({
  id: Uuid,
  employeeCode: EmployeeCode,
  name: EmployeeName,
  gender: GenderSchema,
  /** 僅末 3 碼（§5.1）。完整值不在任何端點提供。 */
  identityNumberMasked: MaskedValue,
  jobTitleName: Nullable(t.String({ maxLength: 128 })),
  departmentName: t.Optional(Nullable(t.String({ maxLength: 128 }))),
  employmentTypeCode: t.Optional(Nullable(EmploymentTypeCodeSchema)),
  /** 「目前任職」的到職日，台北的日曆日，不帶時區標記（§6.1）。 */
  hireDate: t.Optional(Nullable(IsoDate)),
  employmentStatus: t.Optional(Nullable(EmploymentStatusSchema)),
  accountStatus: t.Optional(Nullable(AccountStatusSchema)),
})

/**
 * `get`／`update` 共用的回應（§1.8.0 的三種形狀之一）。
 *
 * **含 `companyUserId`**（UI 定案 `docs/ui/20-employee-list.md` §3.5，見
 * `domain/employee-model.ts` 的 `EmployeeDetail` 檔頭）：`apps/web` 的員工明細頁把 `get` 與
 * `update` 的回應當成同一個「目前這位員工」狀態，`update` 成功後會直接用它的回應覆蓋畫面上的
 * 員工物件——只讓 `get` 帶這一欄的話，`update` 覆蓋回去的那一刻這個欄位就會消失。
 *
 * **`companyUserId` 用 `t.Optional` 包一層，本端點實際上每次都會回它**（handler 沒有任何分支會
 * 省略，見 `employees-main.handler.ts` 的 `toEmployeeDetailData`）。這麼寫是相容性的刻意選擇，
 * 不是欄位真的會缺席：與上面 `EmployeeSummarySchema` 那五欄同一個理由——`apps/web` 既有的測試
 * 與型別是在這一欄還不存在時寫的，若直接宣告成必填，`bun run gen:api` 產生的型別就會要求那些既有
 * fixture 都補上這一欄，而那是前端 Stage 6 的工作範圍（`apps/web/**`），本輪職責只到「後端把資料
 * 生出來、且新欄位在契約上是相容的加法」為止（§1.6：加值、不刪值）。
 */
const EmployeeDetailSchema = t.Object({
  id: Uuid,
  employeeCode: EmployeeCode,
  name: EmployeeName,
  gender: GenderSchema,
  // 以下五欄一律是遮罩後的值（§5.1）。§5.1 允許「完整值只在明確授權的單一端點提供且必寫稽核」，
  // 而那支端點目前不存在——稽核表尚未定案（§9 第 2 項），沒有稽核就不該有完整值端點。
  identityNumberMasked: MaskedValue,
  birthdayMasked: MaskedValue,
  phoneMasked: MaskedValue,
  /** `null` ＝ 沒填 Email；不是「填了但看不到」。兩者必須分得出來。 */
  emailMasked: Nullable(MaskedValue),
  addressMasked: MaskedValue,
  /** 業務時間，台北牆鐘、不帶時區標記（§6.1）：帶了標記前端會依瀏覽器時區再換算一次。 */
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
  /** `null` 代表這位員工目前沒有有效的登入帳號（尚未透過 onboarding 建立帳號，或帳號已停用）。 */
  companyUserId: t.Optional(Nullable(Uuid)),
})

/** 列表的搜尋條件回聲（§1.4）。使用者沒送的條件就不出現，前端才比對得出這包是不是自己要的。 */
const EmployeeSearchSchema = t.Object({
  keyword: t.Optional(EmployeeKeyword),
  departmentId: t.Optional(Uuid),
  employmentStatus: t.Optional(EmploymentStatusSchema),
  accountStatus: t.Optional(AccountStatusSchema),
})

/**
 * `update` 的個資欄位。
 *
 * **身分證、生日、手機、地址皆為選填，省略＝不變更目前值**（定案：`get` 回的這幾欄是遮罩值，
 * 要求連同它們一起全量送出，等於逼前端把身分證明文重新顯示、重新輸入一次才能單獨改一個姓名或
 * 電話——這不只是難用，更是安全上的退步。完整理由見 `domain/employee-model.ts` 的
 * `EmployeeProfileUpdateInput` 檔頭。
 *
 * **`email` 不受影響，維持既有的「選填、省略＝清空」語意**：它本來就有清空這個合法操作，
 * 與另外四欄「沒有清空這回事」的性質不同，因此不套用「省略＝不變更」規則。
 */
const EmployeeProfileFields = {
  employeeCode: EmployeeCode,
  name: EmployeeName,
  gender: GenderSchema,
  identityNumber: t.Optional(IdentityNumber),
  /** 出生年月日，台北的日曆日，不帶時區標記（§6.1）。 */
  birthday: t.Optional(IsoDate),
  phone: t.Optional(Phone),
  email: t.Optional(Email),
  address: t.Optional(Address),
} as const

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。這三種與業務邏輯無關，由 middleware 與
 * 統一 error handler 產生（`900` 未登入／`901` 無權限／`400` 系統錯誤），`data` 恆為 `null`、
 * `errors` 恆為空陣列（§1.3）。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 員工主檔的端點。
 *
 * @param dependencies 由組裝點注入的資料庫、欄位加解密器與 clock。**不在模組層建立連線或讀金鑰**
 *   （§1.7）：`bun run gen:api` 必須能在資料庫未連線、環境變數未設定的情況下產出契約，
 *   否則新人的第一天就會卡在這裡。
 */
export const employeesMainRoutes = (dependencies: EmployeesMainDependencies) =>
  new Elysia({ name: 'employees-main-routes' })
    .use(requestContext)
    .post('/employees/main/list', (context) => handleEmployeeList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employees.main.list'),
        keyword: t.Optional(EmployeeKeyword),
        departmentId: t.Optional(Uuid),
        employmentStatus: t.Optional(EmploymentStatusSchema),
        accountStatus: t.Optional(AccountStatusSchema),
        ...PageRequest,
        sort: t.Optional(sortRequest(EMPLOYEE_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(EmployeeSearchSchema, EmployeeSummarySchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢員工清單',
        description: `${describeEmployeeErrors(EMPLOYEE_ENDPOINT_ERRORS.list)} keyword 只比對員工編號與姓名——其餘個資欄位刻意不開放模糊搜尋。departmentId／employmentStatus／accountStatus 比對的都是「目前」資料，不比對歷史。`,
      },
    })
    .post('/employees/main/get', (context) => handleEmployeeGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('employees.main.get'), id: Uuid }),
      response: {
        // 查無資料是 `data: null`，不是 404（§1.3）。別家公司的員工也回這一種（§3.2）。
        200: envelope(Nullable(EmployeeDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一員工（敏感欄位一律遮罩）',
        description: `${describeEmployeeErrors(EMPLOYEE_ENDPOINT_ERRORS.get)} companyUserId 是這位員工目前有效的登入帳號 id，供前端接著呼叫 company-users/roles/list 查角色、或 company-users/main/reset-password 重設密碼；null 代表這位員工目前沒有有效的登入帳號。`,
      },
    })
    .post('/employees/main/update', (context) => handleEmployeeUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('employees.main.update'),
        id: Uuid,
        // **有 `employeeCode`**，與 `roles/main/update` 不同：員工編號依資料字典是可修改的
        // （只是不得與同公司其他員工重複，且修改前後值須寫稽核——稽核尚未定案，見 §9 第 2 項，
        // 程式碼中的標記在 `impl/employees-main.update.service.ts`）。
        ...EmployeeProfileFields,
      }),
      response: {
        200: envelope(EmployeeDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改員工',
        description: `${describeEmployeeErrors(EMPLOYEE_ENDPOINT_ERRORS.update)} identityNumber／birthday／phone／address 為選填，省略代表不變更目前值（get 回的是遮罩值，不應也不需要被要求原樣送回）；email 維持選填即清空的既有語意，與前四欄不同。`,
      },
    })
    .post('/employees/main/delete', (context) => handleEmployeeDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('employees.main.delete'), id: Uuid }),
      response: {
        // 軟刪除（§4.3）：只回識別碼，刪掉之後沒有「變更後的完整資源」可回。
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除員工（軟刪除）',
        description: describeEmployeeErrors(EMPLOYEE_ENDPOINT_ERRORS.delete),
      },
    })
