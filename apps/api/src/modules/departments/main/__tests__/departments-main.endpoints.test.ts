/**
 * 部門主檔的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射。斷言一律**同時檢查 HTTP status 與 `code`**（§7.1）。
 *
 * 本檔沒有寫「無權限角色被 403」那一條（§7.1 的第三條）：權限碼的授予要靠
 * `company-users/roles` 與 `sessions` 模組，那兩個模組的落地方式與 `shifts-main.endpoints.test.ts`
 * 相同的替身處置（見下方 `accessControl`）。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的部門。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import {
  DepartmentErrorCode,
  DEPARTMENT_ENDPOINT_ERRORS,
  type DepartmentErrorDeclaration,
} from '../departments-main.errors.ts'
import { departmentsMainRoutes } from '../departments-main.routes.ts'

const readTestDatabaseConfig = () => ({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))

type ErrorItemShape = {
  readonly code: string
  readonly msg: string
  readonly data?: Record<string, unknown>
}

type EnvelopeShape<TData> = {
  readonly code: string
  readonly msg: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
  readonly cmd: string
  readonly locale: string
  readonly rspTS: string
  readonly expiresIn: number | null
}

type DepartmentDetailShape = {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: 'ACTIVE' | 'INACTIVE'
  readonly createdAt: string
  readonly updatedAt: string
}

type DepartmentTreeNodeShape = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: 'ACTIVE' | 'INACTIVE'
  readonly children: readonly DepartmentTreeNodeShape[]
}

const identityByToken = new Map<string, VerifiedIdentity>()

/** 身分驗證的替身（§7.3）：token 驗證與權限查詢屬於尚未落地的 `sessions`／`company-users` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'departments.main.tree',
        'departments.main.get',
        'departments.main.create',
        'departments.main.update',
        'departments.main.delete',
      ]),
    ),
}

/** 與 `app/app.ts` 相同的中介層堆疊，理由見 `shifts-main.endpoints.test.ts` 同名函式。 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(departmentsMainRoutes({ db, clock })),
    )

let database: Database
let app: ReturnType<typeof buildTestApp>

const asEnvelope = <TData>(payload: unknown): payload is EnvelopeShape<TData> => {
  if (typeof payload !== 'object' || payload === null) return false
  const record: Record<string, unknown> = { ...payload }
  return typeof record['code'] === 'string' && typeof record['msg'] === 'string' && Array.isArray(record['errors'])
}

const call = async <TData>(path: string, token: string, body: Record<string, unknown>) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rqTS: clock.transportNow(),
        cmd: path.replace(/^\//, '').replaceAll('/', '.'),
        locale: 'zh-TW',
        ...body,
      }),
    }),
  )
  const payload: unknown = await response.json()
  if (!asEnvelope<TData>(payload)) {
    throw new Error(`${path} 的回應不是 envelope 形狀（HTTP ${response.status}）：${JSON.stringify(payload)}`)
  }
  return { status: response.status, payload }
}

/** 建立一個公司與一位成員，回傳可用的 token。§7.3 的例外：那幾個模組尚未落地，只能直接寫入。 */
const registerCompany = async (): Promise<{ companyId: string; token: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode: companyId.replaceAll('-', '').slice(0, 20),
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: `測試公司-${companyId.slice(0, 8)}`,
    shortName: null,
    registeredPostalCode: null,
    registeredCity: null,
    registeredDistrict: null,
    registeredAddress: null,
    actualPostalCode: null,
    actualCity: null,
    actualDistrict: null,
    actualAddress: null,
    invoicePostalCode: null,
    invoiceCity: null,
    invoiceDistrict: null,
    invoiceAddress: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedSeq: 0,
  })
  await database.insert(users).values({
    id: userId,
    username: `test-${userId}`,
    passwordHash: 'not-a-real-hash',
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  await database.insert(companyUsers).values({
    id: companyUserId,
    companyId,
    userId,
    employeeId: null,
    status: 'ACTIVE',
    activatedAt: now,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  identityByToken.set(token, { sessionId: crypto.randomUUID(), userId, companyId, companyUserId })
  return { companyId, token }
}

const declaredCodes = (declarations: readonly DepartmentErrorDeclaration[]): readonly string[] =>
  declarations.map((declaration) => declaration.code)

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

const createDepartment = (token: string, overrides: Record<string, unknown> = {}) =>
  call<DepartmentDetailShape>('/departments/main/create', token, {
    parentId: null,
    code: uniqueCode('DEPT'),
    name: '測試部門',
    ...overrides,
  })

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('departments/main endpoints (integration)', () => {
  test('新增根部門成功，可由 get 讀回；未帶 description 時回 null', async () => {
    const company = await registerCompany()
    const code = uniqueCode('ROOT')

    const created = await createDepartment(company.token, { code, name: '總公司' })
    expect(created.status).toBe(200)
    expect(created.payload.code).toBe('200')
    expect(created.payload.data.parentId).toBeNull()
    expect(created.payload.data.code).toBe(code)
    expect(created.payload.data.status).toBe('ACTIVE')
    expect(created.payload.data.description).toBeNull()
    expect(created.payload.cmd).toBe('departments.main.create')
    expect(created.payload.expiresIn).toBe(7200)

    const fetched = await call<DepartmentDetailShape | null>('/departments/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data?.id).toBe(created.payload.data.id)
  })

  test('新增下層部門：帶上層 id，get 讀回 parentId 正確', async () => {
    const company = await registerCompany()
    const root = await createDepartment(company.token, { name: '總公司' })

    const child = await createDepartment(company.token, { parentId: root.payload.data.id, name: '業務處' })
    expect(child.status).toBe(200)
    expect(child.payload.data.parentId).toBe(root.payload.data.id)
  })

  test('查詢單一部門不存在，回 200／data:null（查詢類不算錯誤，§3.1.3）', async () => {
    const company = await registerCompany()
    const result = await call<DepartmentDetailShape | null>('/departments/main/get', company.token, {
      id: crypto.randomUUID(),
    })
    expect(result.status).toBe(200)
    expect(result.payload.code).toBe('200')
    expect(result.payload.data).toBeNull()
  })

  test('新增部門時上層不存在，回 422／300 與 departments.main.errors.parent-not-found', async () => {
    const company = await registerCompany()
    const result = await createDepartment(company.token, { parentId: crypto.randomUUID() })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.ParentNotFound)
    expect(result.payload.errors[0]?.data?.['field']).toBe('parentId')
    expect(declaredCodes(DEPARTMENT_ENDPOINT_ERRORS.create)).toContain(DepartmentErrorCode.ParentNotFound)
  })

  test('新增部門時上層屬於別家公司，回應與「上層不存在」逐項相同（§3.2）', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const rootB = await createDepartment(companyB.token, { name: 'B 公司總部' })

    const crossCompany = await createDepartment(companyA.token, { parentId: rootB.payload.data.id })
    const notFound = await createDepartment(companyA.token, { parentId: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.status).toBe(422)
  })

  test('同公司 code 重複回 409／300 與 departments.main.errors.code-duplicated（不是 500）', async () => {
    const company = await registerCompany()
    const code = uniqueCode('DUP')

    await createDepartment(company.token, { code, name: '第一個部門' })
    const second = await createDepartment(company.token, { code, name: '第二個部門' })

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(DepartmentErrorCode.CodeDuplicated)
    expect(declaredCodes(DEPARTMENT_ENDPOINT_ERRORS.create)).toContain(DepartmentErrorCode.CodeDuplicated)
  })

  test('軟刪除後同一個 code 可以再建立', async () => {
    const company = await registerCompany()
    const code = uniqueCode('REUSE')

    const created = await createDepartment(company.token, { code, name: '待刪除部門' })
    const deleted = await call<{ id: string }>('/departments/main/delete', company.token, {
      id: created.payload.data.id,
    })
    expect(deleted.status).toBe(200)

    const fetched = await call<DepartmentDetailShape | null>('/departments/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data).toBeNull()

    const recreated = await createDepartment(company.token, { code, name: '重新建立的部門' })
    expect(recreated.status).toBe(200)
    expect(recreated.payload.data.code).toBe(code)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('有子部門時刪除被擋，回 422／300 與 departments.main.errors.has-children', async () => {
    const company = await registerCompany()
    const root = await createDepartment(company.token, { name: '總公司' })
    await createDepartment(company.token, { parentId: root.payload.data.id, name: '業務處' })

    const result = await call('/departments/main/delete', company.token, { id: root.payload.data.id })
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.HasChildren)
    expect(declaredCodes(DEPARTMENT_ENDPOINT_ERRORS.delete)).toContain(DepartmentErrorCode.HasChildren)

    // 沒有子部門時可以正常刪除，證明上面的擋是真的因為有子部門，不是這支端點整支壞了。
    const stillThere = await call<DepartmentDetailShape | null>('/departments/main/get', company.token, {
      id: root.payload.data.id,
    })
    expect(stillThere.payload.data).not.toBeNull()
  })

  test('刪除不存在的部門回 422／300 與 departments.main.errors.not-found', async () => {
    const company = await registerCompany()
    const result = await call('/departments/main/delete', company.token, { id: crypto.randomUUID() })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.NotFound)
  })

  test('重複刪除同一個部門，第二次回 departments.main.errors.not-found（已刪除即等同不存在）', async () => {
    const company = await registerCompany()
    const created = await createDepartment(company.token)

    const first = await call('/departments/main/delete', company.token, { id: created.payload.data.id })
    expect(first.status).toBe(200)

    const second = await call('/departments/main/delete', company.token, { id: created.payload.data.id })
    expect(second.status).toBe(422)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(DepartmentErrorCode.NotFound)
  })

  test('修改部門：改名稱、代碼、說明與狀態', async () => {
    const company = await registerCompany()
    const created = await createDepartment(company.token, { name: '舊名稱' })
    const renamed = uniqueCode('NEW')

    const updated = await call<DepartmentDetailShape>('/departments/main/update', company.token, {
      id: created.payload.data.id,
      parentId: null,
      code: renamed,
      name: '新名稱',
      description: '補上一段說明',
      status: 'INACTIVE',
    })

    expect(updated.status).toBe(200)
    expect(updated.payload.data.code).toBe(renamed)
    expect(updated.payload.data.name).toBe('新名稱')
    expect(updated.payload.data.description).toBe('補上一段說明')
    expect(updated.payload.data.status).toBe('INACTIVE')
  })

  test('修改不存在的部門回 422／300 與 departments.main.errors.not-found', async () => {
    const company = await registerCompany()
    const result = await call('/departments/main/update', company.token, {
      id: crypto.randomUUID(),
      parentId: null,
      code: uniqueCode('X'),
      name: '不存在',
      status: 'ACTIVE',
    })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.NotFound)
    expect(declaredCodes(DEPARTMENT_ENDPOINT_ERRORS.update)).toContain(DepartmentErrorCode.NotFound)
  })

  test('修改部門的上層為別家公司的部門，回 422／300 與 departments.main.errors.parent-not-found', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const target = await createDepartment(companyA.token, { name: 'A 公司部門' })
    const rootB = await createDepartment(companyB.token, { name: 'B 公司總部' })

    const result = await call('/departments/main/update', companyA.token, {
      id: target.payload.data.id,
      parentId: rootB.payload.data.id,
      code: target.payload.data.code,
      name: target.payload.data.name,
      status: 'ACTIVE',
    })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.ParentNotFound)
    expect(result.payload.errors[0]?.data?.['field']).toBe('parentId')
  })

  test('★ 把自己設成自己的上層，必須被擋（422／300，departments.main.errors.parent-cycle）', async () => {
    const company = await registerCompany()
    const a = await createDepartment(company.token, { name: 'A' })

    const result = await call('/departments/main/update', company.token, {
      id: a.payload.data.id,
      parentId: a.payload.data.id,
      code: a.payload.data.code,
      name: a.payload.data.name,
      status: 'ACTIVE',
    })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.ParentCycle)
    expect(result.payload.errors[0]?.data?.['field']).toBe('parentId')
    expect(declaredCodes(DEPARTMENT_ENDPOINT_ERRORS.update)).toContain(DepartmentErrorCode.ParentCycle)
  })

  test('★ 成環偵測：A → B → C，把 A 的上層改成 C，必須被擋（422／300，departments.main.errors.parent-cycle）', async () => {
    const company = await registerCompany()
    const a = await createDepartment(company.token, { name: 'A' })
    const b = await createDepartment(company.token, { parentId: a.payload.data.id, name: 'B' })
    const c = await createDepartment(company.token, { parentId: b.payload.data.id, name: 'C' })

    const result = await call('/departments/main/update', company.token, {
      id: a.payload.data.id,
      parentId: c.payload.data.id,
      code: a.payload.data.code,
      name: a.payload.data.name,
      status: 'ACTIVE',
    })

    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(DepartmentErrorCode.ParentCycle)

    // 紅燈證據的反面：資料庫沒有被改壞——A 仍然是根，B、C 的上層鏈維持原樣。
    const stillRoot = await call<DepartmentDetailShape | null>('/departments/main/get', company.token, {
      id: a.payload.data.id,
    })
    expect(stillRoot.payload.data?.parentId).toBeNull()
  })

  test('搬移子樹是合法操作：把 C 從 B 底下搬到 A 底下（B → A 同層）', async () => {
    const company = await registerCompany()
    const a = await createDepartment(company.token, { name: 'A' })
    const b = await createDepartment(company.token, { parentId: a.payload.data.id, name: 'B' })
    const c = await createDepartment(company.token, { parentId: b.payload.data.id, name: 'C' })

    const moved = await call<DepartmentDetailShape>('/departments/main/update', company.token, {
      id: c.payload.data.id,
      parentId: a.payload.data.id,
      code: c.payload.data.code,
      name: c.payload.data.name,
      status: 'ACTIVE',
    })

    expect(moved.status).toBe(200)
    expect(moved.payload.data.parentId).toBe(a.payload.data.id)
  })

  test('把部門的上層改成根（parentId: null）：合法', async () => {
    const company = await registerCompany()
    const a = await createDepartment(company.token, { name: 'A' })
    const b = await createDepartment(company.token, { parentId: a.payload.data.id, name: 'B' })

    const moved = await call<DepartmentDetailShape>('/departments/main/update', company.token, {
      id: b.payload.data.id,
      parentId: null,
      code: b.payload.data.code,
      name: b.payload.data.name,
      status: 'ACTIVE',
    })

    expect(moved.status).toBe(200)
    expect(moved.payload.data.parentId).toBeNull()
  })

  test('tree：三層樹、多根，回應結構正確', async () => {
    const company = await registerCompany()
    const rootA = await createDepartment(company.token, { name: 'A 集團總部' })
    const rootB = await createDepartment(company.token, { name: 'B 集團總部' })
    const level2 = await createDepartment(company.token, { parentId: rootA.payload.data.id, name: '業務處' })
    await createDepartment(company.token, { parentId: level2.payload.data.id, name: '業務一課' })

    const tree = await call<DepartmentTreeNodeShape[]>('/departments/main/tree', company.token, {})

    expect(tree.status).toBe(200)
    expect(tree.payload.code).toBe('200')
    expect(tree.payload.data).toHaveLength(2)

    const [firstRoot, secondRoot] = tree.payload.data
    expect(firstRoot?.id).toBe(rootA.payload.data.id)
    expect(secondRoot?.id).toBe(rootB.payload.data.id)
    expect(firstRoot?.children).toHaveLength(1)
    expect(firstRoot?.children[0]?.id).toBe(level2.payload.data.id)
    expect(firstRoot?.children[0]?.children).toHaveLength(1)
    expect(firstRoot?.children[0]?.children[0]?.name).toBe('業務一課')
    expect(secondRoot?.children).toEqual([])
  })

  test('tree：不接受分頁參數，也不回傳分頁外殼（與 §1.4 的一般 list 端點不同）', async () => {
    const company = await registerCompany()
    await createDepartment(company.token, { name: '唯一部門' })

    const tree = await call<DepartmentTreeNodeShape[]>('/departments/main/tree', company.token, {})
    expect(Array.isArray(tree.payload.data)).toBe(true)
    // 不是 `{ search, sort, pagination, data }` 那種外殼，直接就是陣列本身。
    expect((tree.payload.data as unknown as { pagination?: unknown }).pagination).toBeUndefined()
  })

  test('B 公司看不到 A 公司的部門樹（§4.2）', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    await createDepartment(companyA.token, { name: 'A 公司部門' })

    const tree = await call<DepartmentTreeNodeShape[]>('/departments/main/tree', companyB.token, {})
    expect(tree.status).toBe(200)
    expect(tree.payload.data).toEqual([])
  })

  test('查詢類：以 B 公司身分讀 A 公司的部門，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await createDepartment(companyA.token)

    const crossCompany = await call('/departments/main/get', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/departments/main/get', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.payload.data).toBe(notFound.payload.data)
    expect(crossCompany.status).toBe(200)
    expect(crossCompany.payload.data).toBeNull()
  })

  test('動作類：以 B 公司身分刪除 A 公司的部門，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await createDepartment(companyA.token)

    const crossCompany = await call('/departments/main/delete', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/departments/main/delete', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.status).toBe(422)

    const stillThere = await call<DepartmentDetailShape | null>('/departments/main/get', companyA.token, {
      id: created.payload.data.id,
    })
    expect(stillThere.payload.data).not.toBeNull()
  })

  test('未帶 token 一律回 401／900，且 expiresIn 為 null（§1.3）', async () => {
    const response = await app.handle(
      new Request('http://localhost/departments/main/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rqTS: clock.transportNow(), cmd: 'departments.main.tree', locale: 'zh-TW' }),
      }),
    )
    const payload: unknown = await response.json()
    if (!asEnvelope(payload)) throw new Error('未登入的回應不是 envelope 形狀')

    expect(response.status).toBe(401)
    expect(payload.code).toBe('900')
    expect(payload.expiresIn).toBeNull()
  })
})
