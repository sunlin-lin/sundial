/**
 * 角色主檔的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 * 手工組 envelope 會漏欄位、會拼錯欄位名，而這兩件事都不會有任何編譯錯誤。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { RolesMainContext } from './domain/role-context.ts'
import { resolveRoleSort, toRoleListView } from './domain/role-list-view.ts'
import type { RoleDetail, RoleListPage, RoleListQuery, RoleStatusValue, RoleSummary } from './domain/role-model.ts'
import {
  activateRole,
  createRole,
  deactivateRole,
  deleteRole,
  getRole,
  listRoles,
  updateRole,
} from './roles-main.service.ts'

/** 由組裝點注入的相依。公司範圍不在裡面——它只能來自每一次請求的已驗證身分（§4.2）。 */
export type RolesMainDependencies = Omit<RolesMainContext, 'companyId'>

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
 * `EnvelopeBody<null>` 那一支是錯誤路徑——邊界層映射的產物，`data` 恆為 `null`。
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
    throw new Error('角色端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toRoleContext = (dependencies: RolesMainDependencies, identity: VerifiedIdentity): RolesMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
})

/**
 * 業務資料 → 本端點的 `data`。
 *
 * **必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的回傳值指派給 `data`，
 * 資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變——那是個資外洩最常見的路徑。
 */
const toRoleSummaryData = (role: RoleSummary) => ({
  id: role.id,
  code: role.code,
  name: role.name,
  status: role.status,
  isSystem: role.isSystem,
})

const toRoleDetailData = (role: RoleDetail) => ({
  id: role.id,
  code: role.code,
  name: role.name,
  description: role.description,
  status: role.status,
  isSystem: role.isSystem,
  // 展開成可變陣列：業務型別刻意是 readonly（跨層傳遞時不該被改），對外的 `data` 則是一份新的拷貝。
  permissionIds: [...role.permissionIds],
  assignedUserCount: role.assignedUserCount,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableRoleDetailData = (role: RoleDetail | null) => (role === null ? null : toRoleDetailData(role))

type ListBody = {
  readonly keyword?: string
  readonly status?: RoleStatusValue
  readonly perPage: number
  readonly currentPage: number
  readonly sort?: { readonly field: string; readonly order: 'asc' | 'desc' }
}

type TargetBody = { readonly id: string }

type CreateBody = {
  readonly code: string
  readonly name: string
  readonly description?: string
  readonly permissionIds: readonly string[]
}

type UpdateBody = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly permissionIds: readonly string[]
}

/**
 * 搜尋條件的回聲（§1.4）。
 *
 * 只放使用者真的送來的條件，沒送的欄位就不出現：回聲的用途是讓前端比對「這包回應是不是我現在
 * 畫面上這組條件的結果」，把沒送的欄位補成 `null` 會讓比對多一層「null 等不等於沒送」的判斷。
 */
const toSearchEcho = (body: ListBody) => ({
  ...(body.keyword === undefined ? {} : { keyword: body.keyword }),
  ...(body.status === undefined ? {} : { status: body.status }),
})

const toRoleListData = (query: RoleListQuery, body: ListBody, page: RoleListPage) =>
  toRoleListView(query, toSearchEcho(body), page.totalCount, page.items.map(toRoleSummaryData))

/** 各端點 `data` 的型別。由映射函式反推，因此**改了映射就會改型別**，不會兩邊漂移。 */
export type RoleDetailData = ReturnType<typeof toRoleDetailData>
export type RoleListData = ReturnType<typeof toRoleListData>
export type DeletedRoleData = { readonly id: string }

export const handleRoleList = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<ListBody>,
): Promise<EndpointResult<RoleListData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const query: RoleListQuery = {
    keyword: context.body.keyword ?? null,
    status: context.body.status ?? null,
    perPage: context.body.perPage,
    currentPage: context.body.currentPage,
    // 預設排序在這裡補上，回聲的才會是**實際生效**的排序（§1.4）。
    sort: resolveRoleSort(context.body.sort),
  }

  const result = await listRoles(toRoleContext(dependencies, identity), query)
  const outcome = resolveServiceResult(result, (page) => toRoleListData(query, context.body, page))
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleGet = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<RoleDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getRole(toRoleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableRoleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleCreate = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<RoleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createRole(toRoleContext(dependencies, identity), {
    code: context.body.code,
    name: context.body.name,
    // 選填欄位一律收斂成 `null`：`exactOptionalPropertyTypes` 之下，「沒有這個欄位」與
    // 「欄位是 undefined」是兩件事，而後者寫進 DB 會把既有值蓋成 NULL。
    description: context.body.description ?? null,
    permissionIds: context.body.permissionIds,
  })
  const outcome = resolveServiceResult(result, toRoleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleUpdate = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<RoleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateRole(toRoleContext(dependencies, identity), {
    id: context.body.id,
    name: context.body.name,
    description: context.body.description ?? null,
    permissionIds: context.body.permissionIds,
  })
  const outcome = resolveServiceResult(result, toRoleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleDelete = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedRoleData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteRole(toRoleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleActivate = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<RoleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await activateRole(toRoleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toRoleDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleRoleDeactivate = async (
  dependencies: RolesMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<RoleDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deactivateRole(toRoleContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toRoleDetailData)
  context.set.status = outcome.status
  return outcome.body
}
