/**
 * 員工主檔的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 *
 * **本層拿不到任何明文個資**：service 回來的型別上只有 `xxxMasked`（遮罩在 repository 解密的
 * 當下就做完了，見 `domain/employee-secrets.ts`）。因此 §5.1「對外回應一律遮罩」在這裡
 * 不是一條要記得遵守的規則，而是一個寫不出違反版本的事實。
 * 反方向（`update` 的 body）確實帶明文，那些值只往下傳給 service，**不進 log**。
 *
 * **沒有 `handleEmployeeCreate`**：`/employees/main/create` 端點已移除（實作計畫
 * `05-employee-onboarding.md` §4.2），`ProfileBody`／`toProfileInput` 仍然保留，是因為
 * `update` 端點還在用（差別只在多一個 `id`，見下方 `UpdateBody`）——現在只剩 `update` 這一個
 * 用途，因此 `ProfileBody` 的形狀就是 `update` 端點的形狀（身分證、生日、手機、地址皆選填，
 * 省略＝不變更，見 `domain/employee-model.ts` 的 `EmployeeProfileUpdateInput` 檔頭）。
 *
 * **`get`／`update` 回應共用 `EmployeeDetail`**（含 `companyUserId`，UI 定案
 * `docs/ui/20-employee-list.md` §3.5），因此共用同一個映射函式 `toEmployeeDetailData`
 * ——理由見 `domain/employee-model.ts` 的 `EmployeeDetail` 檔頭：`apps/web` 把兩支端點的回應
 * 當成同一個「目前這位員工」狀態，只有其中一支帶這一欄的話，另一支覆蓋回去的那一刻它就會消失。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import { toListView } from '../../../shared/list-view.ts'
import type { EmployeesMainContext } from './domain/employee-context.ts'
import { resolveEmployeeSort } from './domain/employee-list-view.ts'
import type {
  CompanyUserStatusValue,
  EmployeeDetail,
  EmployeeListItem,
  EmployeeListPage,
  EmployeeListQuery,
  EmployeeSummary,
  EmploymentStatusValue,
  GenderValue,
} from './domain/employee-model.ts'
import { deleteEmployee, getEmployee, listEmployees, updateEmployee } from './employees-main.service.ts'

/**
 * 由組裝點注入的相依。**公司範圍與操作者都不在裡面**——兩者只能來自每一次請求的已驗證身分
 * （§4.2、稽核計畫 §5），放進模組層級的相依會變成整個服務共用一個值，那正是跨公司外洩／
 * 稽核冒名的形狀。
 */
export type EmployeesMainDependencies = Omit<EmployeesMainContext, 'companyId' | 'operatorCompanyUserId'>

/**
 * handler 需要的請求上下文。
 *
 * 刻意宣告成**結構型別**而不是 import Elysia 的 context 型別：這裡真正需要的只有三樣東西，
 * 而 Elysia 的 context 型別帶著一長串泛型參數，寫進每一支 handler 的簽章之後，
 * 框架版本一升級就要逐支改。傳進來的實際物件欄位更多，結構相容即可。
 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  /** 只用來設定 HTTP status；status 與 envelope `code` 是同一次映射一起決定的（§1.8.1）。 */
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

/**
 * handler 的回傳：envelope 的**前半段**。
 *
 * 成功與失敗都是這一種形狀（§1.8.4 成功與失敗走同一個出口），差別只在 `code` 與 `data`。
 */
type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 取出本次請求的已驗證身分。
 *
 * `session` 為 `null` 代表這支端點沒有掛在已登入群組上（§1.9.2）——那是**程式組裝錯誤**，
 * 不是使用者做錯了什麼，因此走例外路徑（§3.1.2）：回一個業務錯誤會讓這個漏洞看起來像
 * 一次普通的操作失敗，而它其實是「這支端點沒有驗身分」。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('員工端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toEmployeeContext = (
  dependencies: EmployeesMainDependencies,
  identity: VerifiedIdentity,
): EmployeesMainContext => ({
  db: dependencies.db,
  cipher: dependencies.cipher,
  clock: dependencies.clock,
  companyId: identity.companyId,
  // 稽核的操作者一律由已驗證身分推導，不信任請求帶來的任何識別碼（§5.2）。
  operatorCompanyUserId: identity.companyUserId,
})

/**
 * 業務資料 → 本端點的 `data`。
 *
 * **必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的回傳值指派給 `data`，
 * 資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變——那是個資外洩最常見的路徑。
 */
const toEmployeeSummaryData = (employee: EmployeeSummary) => ({
  id: employee.id,
  employeeCode: employee.employeeCode,
  name: employee.name,
  gender: employee.gender,
  identityNumberMasked: employee.identityNumberMasked,
})

/**
 * 列表單筆 → 本端點的 `data`。多出職稱、部門、僱用類型、到職日、任職狀態與帳號狀態六欄
 * （UI 定案 `docs/ui/20-employee-list.md` §1），理由見 `domain/employee-model.ts` 的
 * `EmployeeListItem` 檔頭。
 */
const toEmployeeListItemData = (employee: EmployeeListItem) => ({
  ...toEmployeeSummaryData(employee),
  jobTitleName: employee.jobTitleName,
  departmentName: employee.departmentName,
  employmentTypeCode: employee.employmentTypeCode,
  hireDate: employee.hireDate,
  employmentStatus: employee.employmentStatus,
  accountStatus: employee.accountStatus,
})

const toEmployeeDetailData = (employee: EmployeeDetail) => ({
  ...toEmployeeSummaryData(employee),
  birthdayMasked: employee.birthdayMasked,
  phoneMasked: employee.phoneMasked,
  emailMasked: employee.emailMasked,
  addressMasked: employee.addressMasked,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
  companyUserId: employee.companyUserId,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableEmployeeDetailData = (employee: EmployeeDetail | null) =>
  employee === null ? null : toEmployeeDetailData(employee)

type ListBody = {
  readonly keyword?: string
  readonly departmentId?: string
  readonly employmentStatus?: EmploymentStatusValue
  readonly accountStatus?: CompanyUserStatusValue
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: string; readonly order: 'asc' | 'desc' }
}

type TargetBody = { readonly id: string }

/**
 * `update` 的個資欄位。
 *
 * **身分證、生日、手機、地址皆為選填，省略＝不變更目前值**（定案理由見
 * `domain/employee-model.ts` 的 `EmployeeProfileUpdateInput` 檔頭）。`email` 不在此列，
 * 維持既有的「選填、省略＝清空」語意——它本來就有清空這個合法操作，兩者不可混為一談。
 */
type ProfileBody = {
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber?: string
  readonly birthday?: string
  readonly phone?: string
  readonly email?: string
  readonly address?: string
}

type UpdateBody = TargetBody & ProfileBody

/**
 * 搜尋條件的回聲（§1.4）。
 *
 * 只放使用者真的送來的條件，沒送的欄位就不出現：回聲的用途是讓前端比對「這包回應是不是我現在
 * 畫面上這組條件的結果」，把沒送的欄位補成 `null` 會讓比對多一層「null 等不等於沒送」的判斷。
 */
const toSearchEcho = (body: ListBody) => ({
  ...(body.keyword === undefined ? {} : { keyword: body.keyword }),
  ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
  ...(body.employmentStatus === undefined ? {} : { employmentStatus: body.employmentStatus }),
  ...(body.accountStatus === undefined ? {} : { accountStatus: body.accountStatus }),
})

/**
 * body 的個資欄位 → service 的輸入。
 *
 * **`email` 選填欄位收斂成 `null`**：`exactOptionalPropertyTypes` 之下，「沒有這個欄位」與
 * 「欄位是 undefined」是兩件事，而後者寫進 DB 會把既有值蓋成 NULL——email 本來就有這個合法的
 * 清空操作，收斂成 `null` 正是要的效果。
 *
 * **身分證、生日、手機、地址四欄則相反：維持「沒有這個 key 就是沒有」，不收斂成任何值。**
 * 這四欄在 `EmployeeProfileUpdateInput` 上是選填的、省略＝不變更目前值（見該型別檔頭），
 * 如果比照 email 收斂成 `null`，會把「沒填」誤譯成「使用者要清空」——而這四欄根本沒有清空這個
 * 合法操作，接下去 repository 會拿 `null` 去加密、寫出一個不該存在的空字串密文。因此這裡用
 * 展開＋條件式 key 的寫法，讓「沒有這個欄位」原封不動地傳到 service（`exactOptionalPropertyTypes`
 * 之下不能直接寫 `identityNumber: body.identityNumber`，那會把型別是 `string | undefined` 的值
 * 指派給宣告為選填、不接受顯式 `undefined` 的 key）。
 */
const toProfileInput = (body: ProfileBody) => ({
  employeeCode: body.employeeCode,
  name: body.name,
  gender: body.gender,
  ...(body.identityNumber === undefined ? {} : { identityNumber: body.identityNumber }),
  ...(body.birthday === undefined ? {} : { birthday: body.birthday }),
  ...(body.phone === undefined ? {} : { phone: body.phone }),
  email: body.email ?? null,
  ...(body.address === undefined ? {} : { address: body.address }),
})

const toEmployeeListData = (query: EmployeeListQuery, body: ListBody, page: EmployeeListPage) =>
  // `search` 與 `sort` 由**共用的** list 組裝函式帶回（§1.8.1），不讓端點自己填：
  // 這兩段是最常被忘記填的東西，而漏填是靜默的——前端的 race condition 防護當場失效。
  toListView(
    toSearchEcho(body),
    query.sort,
    { currentPage: query.currentPage, perPage: query.perPage, totalCount: page.totalCount },
    page.items.map(toEmployeeListItemData),
  )

/** 各端點 `data` 的型別。由映射函式反推，因此**改了映射就會改型別**，不會兩邊漂移。 */
export type EmployeeDetailData = ReturnType<typeof toEmployeeDetailData>
export type EmployeeListData = ReturnType<typeof toEmployeeListData>
export type DeletedEmployeeData = { readonly id: string }

export const handleEmployeeList = async (
  dependencies: EmployeesMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<EmployeeListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: EmployeeListQuery = {
    keyword: context.body.keyword ?? null,
    departmentId: context.body.departmentId ?? null,
    employmentStatus: context.body.employmentStatus ?? null,
    accountStatus: context.body.accountStatus ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    // 預設排序在這裡補上，回聲的才會是**實際生效**的排序（§1.4）。
    sort: resolveEmployeeSort(context.body.sort),
  }

  const result = await listEmployees(toEmployeeContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toEmployeeListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmployeeGet = async (
  dependencies: EmployeesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<EmployeeDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getEmployee(toEmployeeContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableEmployeeDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmployeeUpdate = async (
  dependencies: EmployeesMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<EmployeeDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateEmployee(toEmployeeContext(dependencies, identity), {
    id: context.body.id,
    ...toProfileInput(context.body),
  })
  const outcome = resolveServiceResult(result, toEmployeeDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleEmployeeDelete = async (
  dependencies: EmployeesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedEmployeeData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteEmployee(toEmployeeContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}
