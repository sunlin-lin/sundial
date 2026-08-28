/**
 * 部門主檔的端點 handler（§1.8.0 的④與⑥）。
 *
 * 每個函式只做三件事：把驗證後的 body 轉成 service 的輸入型別 → 呼叫 service →
 * 把業務資料**經由明確的映射函式**收成本端點的 `data`。因此這一層在結構上不會長大，
 * §0.4 也就規定它不拆。
 *
 * 這裡**不得自行填 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`，也不得自己組 `errors`**
 * （§1.8.2）：那些欄位各自只有一個地方會寫它。handler 只回邊界層映射的產物，其餘由出口層補上。
 */
import { resolveServiceResult } from '../../../http/error-boundary.ts'
import type { RequestSession } from '../../../http/request-context.ts'
import type { VerifiedIdentity } from '../../../shared/access-control.ts'
import type { EnvelopeBody } from '../../../shared/envelope.ts'
import type { DepartmentsMainContext } from './domain/department-context.ts'
import type {
  CreateDepartmentInput,
  DepartmentDetail,
  DepartmentStatusValue,
  DepartmentTreeNode,
  UpdateDepartmentInput,
} from './domain/department-model.ts'
import {
  createDepartment,
  deleteDepartment,
  getDepartment,
  getDepartmentTree,
  updateDepartment,
} from './departments-main.service.ts'

/** 由組裝點注入的相依。公司範圍不在裡面——它只能來自每一次請求的已驗證身分（§4.2）。 */
export type DepartmentsMainDependencies = Omit<DepartmentsMainContext, 'companyId'>

/** 與 `shifts-main.handler.ts`／`employees-main.handler.ts` 相同的結構型別化 context，理由見該檔說明。 */
export type EndpointContext<TBody> = {
  readonly body: TBody
  readonly set: { status?: number | string }
  readonly requestContext: { readonly session: RequestSession | null }
}

type EndpointResult<TData> = EnvelopeBody<TData> | EnvelopeBody<null>

/**
 * 取出本次請求的已驗證身分。`session` 為 `null` 代表程式組裝錯誤（§1.9.2），走例外路徑（§3.1.2）
 * ——理由與 `shifts-main.handler.ts` 的同名函式相同。
 */
const requireIdentity = (session: RequestSession | null): VerifiedIdentity => {
  if (session === null) {
    throw new Error('部門端點取不到已驗證身分：該端點未掛在已登入群組內（§1.9.2）')
  }
  return session.identity
}

const toDepartmentContext = (
  dependencies: DepartmentsMainDependencies,
  identity: VerifiedIdentity,
): DepartmentsMainContext => ({
  db: dependencies.db,
  clock: dependencies.clock,
  companyId: identity.companyId,
})

/**
 * 業務資料 → 本端點的 `data`。**必須是明確的映射函式**（§2、§1.8.0 的⑥）：直接把 service 的
 * 回傳值指派給 `data`，資料表加一個欄位就會自動出現在 API 上。
 *
 * **遞迴映射**：部門樹的每一層都是同一個形狀，遞迴呼叫自己一次處理一層。
 */
const toDepartmentTreeNodeData = (node: DepartmentTreeNode): DepartmentTreeNodeData => ({
  id: node.id,
  code: node.code,
  name: node.name,
  description: node.description,
  status: node.status,
  children: node.children.map(toDepartmentTreeNodeData),
})

const toDepartmentDetailData = (department: DepartmentDetail) => ({
  id: department.id,
  parentId: department.parentId,
  code: department.code,
  name: department.name,
  description: department.description,
  status: department.status,
  createdAt: department.createdAt,
  updatedAt: department.updatedAt,
})

/** 查詢類端點查無資料時 `data` 為 `null`（§1.3），不是錯誤（§3.1.3）。 */
const toNullableDepartmentDetailData = (department: DepartmentDetail | null) =>
  department === null ? null : toDepartmentDetailData(department)

/**
 * `tree` 沒有任何業務欄位——只有基底三欄（比照 `sessions-main.handler.ts` 的 `CredentialOnlyBody`：
 * 「這支端點的業務輸入就是沒有輸入」與「忘了宣告輸入」在型別上必須長得不一樣）。
 */
type TreeBody = {
  readonly rqTS: string
  readonly cmd: string
  readonly locale: string
}

type TargetBody = { readonly id: string }

type CreateBody = {
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description?: string
}

type UpdateBody = TargetBody & {
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description?: string
  readonly status: DepartmentStatusValue
}

const toCreateInput = (body: CreateBody): CreateDepartmentInput => ({
  parentId: body.parentId,
  code: body.code,
  name: body.name,
  // 選填欄位收斂成 `string | null`：跨層傳遞只有一種「沒有說明」的表示法，
  // 不讓 `undefined` 與 `null` 在 domain 層並存（理由與 `shift-model.ts` 的 `ShiftListQuery`
  // 選填條件一律用 `null` 相同）。
  description: body.description ?? null,
})

const toUpdateInput = (body: UpdateBody): UpdateDepartmentInput => ({
  id: body.id,
  parentId: body.parentId,
  code: body.code,
  name: body.name,
  description: body.description ?? null,
  status: body.status,
})

/** 各端點 `data` 的型別。由映射函式反推，因此改了映射就會改型別，不會兩邊漂移。 */
export type DepartmentTreeNodeData = {
  id: string
  code: string
  name: string
  description: string | null
  status: DepartmentStatusValue
  children: DepartmentTreeNodeData[]
}
export type DepartmentDetailData = ReturnType<typeof toDepartmentDetailData>
export type DeletedDepartmentData = { readonly id: string }

export const handleDepartmentTree = async (
  dependencies: DepartmentsMainDependencies,
  context: EndpointContext<TreeBody>,
): Promise<EndpointResult<DepartmentTreeNodeData[]>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getDepartmentTree(toDepartmentContext(dependencies, identity))
  const outcome = resolveServiceResult(result, (tree) => tree.map(toDepartmentTreeNodeData))
  context.set.status = outcome.status
  return outcome.body
}

export const handleDepartmentGet = async (
  dependencies: DepartmentsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DepartmentDetailData | null>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await getDepartment(toDepartmentContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, toNullableDepartmentDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDepartmentCreate = async (
  dependencies: DepartmentsMainDependencies,
  context: EndpointContext<CreateBody>,
): Promise<EndpointResult<DepartmentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await createDepartment(toDepartmentContext(dependencies, identity), toCreateInput(context.body))
  const outcome = resolveServiceResult(result, toDepartmentDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDepartmentUpdate = async (
  dependencies: DepartmentsMainDependencies,
  context: EndpointContext<UpdateBody>,
): Promise<EndpointResult<DepartmentDetailData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await updateDepartment(toDepartmentContext(dependencies, identity), toUpdateInput(context.body))
  const outcome = resolveServiceResult(result, toDepartmentDetailData)
  context.set.status = outcome.status
  return outcome.body
}

export const handleDepartmentDelete = async (
  dependencies: DepartmentsMainDependencies,
  context: EndpointContext<TargetBody>,
): Promise<EndpointResult<DeletedDepartmentData>> => {
  const identity = requireIdentity(context.requestContext.session)
  const result = await deleteDepartment(toDepartmentContext(dependencies, identity), { id: context.body.id })
  const outcome = resolveServiceResult(result, (deleted) => ({ id: deleted.id }))
  context.set.status = outcome.status
  return outcome.body
}
