/**
 * 角色主檔的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射、以及錯誤集合有沒有整包帶出來——那些全部發生在
 * handler 與邊界層，繞過它們就等於沒測到。斷言一律**同時檢查 HTTP status 與 `code`**（§7.1）：
 * 只檢查其中一項會漏掉映射寫錯的情況。
 *
 * 本檔沒有寫「無權限角色被 403」那一條（§7.1 的第三條）：權限碼的授予要靠
 * `company-users/roles` 模組，那個模組尚未落地，硬寫出來只會是在測本檔自己的假資料。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的角色，
 * 因此不需要 truncate，也不會產生「只在特定執行順序下失敗」的測試。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { inArray } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUserRoles, companyUsers, permissions, roles, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { RoleErrorCode, ROLE_ENDPOINT_ERRORS, type RoleErrorDeclaration } from '../roles-main.errors.ts'
import { rolesMainRoutes } from '../roles-main.routes.ts'

/**
 * 直接讀環境變數組出資料庫設定，不走 `shared/config.ts`。
 *
 * `loadConfig()` 會一併要求 `ACCESS_TOKEN_SECRET`／`PORT` 這些與本測試完全無關的變數，
 * 少一個就會讓整批測試以一個看不出成因的訊息失敗。連的是不是測試資料庫由 `test-setup.ts`
 * 的 preload 守衛（§7.4），這裡不重複那道檢查。
 */
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

type RoleDetailShape = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: string
  readonly isSystem: boolean
  readonly permissionIds: readonly string[]
  readonly assignedUserCount: number
}

type RoleListShape = {
  readonly search: Record<string, unknown>
  readonly sort: { readonly field: string; readonly order: string }
  readonly pagination: { readonly currentPage: number; readonly perPage: number; readonly totalCount: number }
  readonly data: readonly { readonly id: string; readonly code: string }[]
}

/** 每個 token 對應一個已驗證身分。測試以此模擬「不同公司的使用者」。 */
const identityByToken = new Map<string, VerifiedIdentity>()

/**
 * 身分驗證的替身。
 *
 * §7.3 禁止 mock 掉**被測邏輯本身**，而 token 驗證與權限查詢屬於 `sessions`／`company-users`
 * 兩個尚未落地的模組——它們不是本檔要測的東西。權限碼一律放行，因為「無權限被 403」那條
 * 需要真正的權限指派流程才測得有意義（見檔頭）。
 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'roles.main.list',
        'roles.main.get',
        'roles.main.create',
        'roles.main.update',
        'roles.main.delete',
        'roles.main.activate',
        'roles.main.deactivate',
      ]),
    ),
}

/**
 * 與 `app/app.ts` 相同的中介層堆疊。
 *
 * 逐字照抄組裝順序（error handler 包住全部、出口層在路由之前、認證群組包住端點），
 * 測到的才是正式環境真正會跑的那一條路徑。**目前只能在測試裡自己組**：骨架的
 * `app/routes.ts` 尚未把本模組掛上去，且 `AppDependencies` 沒有資料庫欄位（已寫進交付回報）。
 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(rolesMainRoutes({ db, clock })),
    )

let database: Database
let app: ReturnType<typeof buildTestApp>
/** seed migration 建立的權限碼 → id。 */
let permissionIdByCode: ReadonlyMap<string, string>

/**
 * 收窄 `response.json()`（型別是 `unknown`）到 envelope 形狀。
 *
 * **刻意是一個真的會檢查的守衛，而不是一次型別斷言**（§2.2 禁止用 `as` 硬轉）：
 * 這裡收的是 HTTP 邊界外的位元組，形狀本來就沒有任何靜態保證。用 `as` 的話，
 * 回應少了一整包 envelope（例如 middleware 出錯、直接回了一個框架的錯誤物件）時，
 * 測試會在後面某一行以 `Cannot read properties of undefined` 失敗，而那個訊息與真正的成因無關，
 * 每次都要重跑一次把回應印出來才知道發生什麼事。檢查在這裡做，訊息就直接是那包回應本身。
 *
 * `data` 的內容**不在這裡驗**——它逐支端點都不一樣，由各條測試自己斷言；
 * 本守衛只負責「這是不是一包 envelope」。
 */
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

/** 建立一個公司與一位成員，回傳可用的 token。 */
const registerCompany = async (): Promise<{ companyId: string; companyUserId: string; token: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  // §7.3 的例外：`companies`、`users` 與 `company_users` 目前**沒有任何正式流程**可以建立
  //（那幾個模組尚未落地），只能直接寫入。註明理由是規範的要求，不是慣例。
  //
  // `companies` 這一列是後來補的：`company_users.company_id` 自
  // `0005_add_company_foreign_keys.sql` 起有 FK → `companies.id`，少了公司主檔，成員根本寫不進去。
  // 這正是那條外鍵要擋的事——測試原本建立的是一個公司不存在的成員，而在加外鍵之前它寫得進去。
  await database.insert(companies).values({
    id: companyId,
    // 全域唯一；取 UUID 去掉分隔符的前 20 碼，同一次測試執行內不會相撞。
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
  return { companyId, companyUserId, token }
}

const requirePermissionId = (code: string): string => {
  const id = permissionIdByCode.get(code)
  if (id === undefined) {
    throw new Error(`測試前提不成立：權限碼 ${code} 不在資料庫裡，請確認 seed migration 已套用`)
  }
  return id
}

/** 端點宣告的錯誤碼清單（§1.8.3）：測試中斷言到的碼必須落在裡面。 */
const declaredCodes = (declarations: readonly RoleErrorDeclaration[]): readonly string[] =>
  declarations.map((declaration) => declaration.code)

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

beforeAll(async () => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)

  const rows = await database
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, ['roles.main', 'roles.main.list', 'roles.main.get', 'roles.main.create']))
  permissionIdByCode = new Map(rows.map((row): readonly [string, string] => [row.code, row.id]))
})

describe('roles/main endpoints (integration)', () => {
  test('建立角色成功，並能由 get 與 list 讀回（含權限指派）', async () => {
    const company = await registerCompany()
    const code = uniqueCode('VIEWER')

    const created = await call<RoleDetailShape>('/roles/main/create', company.token, {
      code,
      name: '檢視者',
      description: '只能看',
      permissionIds: [requirePermissionId('roles.main.list'), requirePermissionId('roles.main.get')],
    })

    expect(created.status).toBe(200)
    expect(created.payload.code).toBe('200')
    expect(created.payload.errors).toEqual([])
    expect(created.payload.data.code).toBe(code)
    expect(created.payload.data.status).toBe('ACTIVE')
    expect(created.payload.data.isSystem).toBe(false)
    expect(created.payload.data.assignedUserCount).toBe(0)
    expect([...created.payload.data.permissionIds].sort()).toEqual(
      [requirePermissionId('roles.main.list'), requirePermissionId('roles.main.get')].sort(),
    )
    // envelope 的尾段由出口層補上（§1.8.2），handler 一個字都沒填。
    expect(created.payload.cmd).toBe('roles.main.create')
    expect(created.payload.locale).toBe('zh-TW')
    expect(created.payload.expiresIn).toBe(7200)

    const fetched = await call<RoleDetailShape | null>('/roles/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.status).toBe(200)
    expect(fetched.payload.data?.name).toBe('檢視者')

    const listed = await call<RoleListShape>('/roles/main/list', company.token, {
      keyword: code,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.pagination.totalCount).toBe(1)
    expect(listed.payload.data.data[0]?.id).toBe(created.payload.data.id)
    // `search` 與 `sort` 必須原樣回聲（§1.4）；沒送 sort 時回的是實際生效的預設值。
    expect(listed.payload.data.search).toEqual({ keyword: code })
    expect(listed.payload.data.sort).toEqual({ field: 'code', order: 'asc' })
  })

  test('查無資料的清單回空陣列與正確的 pagination，不是錯誤', async () => {
    const company = await registerCompany()

    const listed = await call<RoleListShape>('/roles/main/list', company.token, {
      keyword: '不存在的關鍵字',
      perPage: 20,
      currentPage: 1,
    })

    expect(listed.status).toBe(200)
    expect(listed.payload.code).toBe('200')
    expect(listed.payload.data.data).toEqual([])
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })

  test('代碼重複回 409／300 與 role.code-duplicated，且不回聲既有角色', async () => {
    const company = await registerCompany()
    const code = uniqueCode('DUP')
    const permissionIds = [requirePermissionId('roles.main.list')]

    await call('/roles/main/create', company.token, { code, name: '第一個', permissionIds })
    const second = await call('/roles/main/create', company.token, { code, name: '第二個', permissionIds })

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors).toHaveLength(1)
    expect(second.payload.errors[0]?.code).toBe(RoleErrorCode.CodeDuplicated)
    expect(declaredCodes(ROLE_ENDPOINT_ERRORS.create)).toContain(RoleErrorCode.CodeDuplicated)
    // §3.2：不得回聲是哪一筆既有資料重複——否則建立表單就變成反查工具。
    expect(JSON.stringify(second.payload)).not.toContain('第一個')
  })

  test('一次違反兩條規則時，errors 同時回兩筆且各自帶索引', async () => {
    const company = await registerCompany()
    const missingPermissionId = crypto.randomUUID()

    const created = await call('/roles/main/create', company.token, {
      code: uniqueCode('MULTI'),
      name: '兩個問題',
      permissionIds: [
        requirePermissionId('roles.main.list'),
        missingPermissionId,
        // 分類節點：存在但 is_assignable = false。
        requirePermissionId('roles.main'),
      ],
    })

    expect(created.status).toBe(422)
    expect(created.payload.code).toBe('300')
    // 這條是唯一能證明 service 真的在收集、而不是第一筆就中斷的方式（§7.1）。
    expect(created.payload.errors).toHaveLength(2)
    expect(created.payload.errors[0]?.code).toBe(RoleErrorCode.PermissionNotFound)
    expect(created.payload.errors[0]?.data?.['field']).toBe('permissionIds.1')
    expect(created.payload.errors[1]?.code).toBe(RoleErrorCode.PermissionNotAssignable)
    expect(created.payload.errors[1]?.data?.['field']).toBe('permissionIds.2')
    for (const error of created.payload.errors) {
      expect(declaredCodes(ROLE_ENDPOINT_ERRORS.create)).toContain(error.code)
    }
  })

  test('仍被成員使用的角色不可刪除', async () => {
    const company = await registerCompany()
    const created = await call<RoleDetailShape>('/roles/main/create', company.token, {
      code: uniqueCode('INUSE'),
      name: '使用中',
      permissionIds: [requirePermissionId('roles.main.list')],
    })
    const now = clock.now()

    // §7.3 的例外：角色指派的正式流程屬於 `company-users/roles` 模組，尚未落地。
    await database.insert(companyUserRoles).values({
      id: crypto.randomUUID(),
      companyId: company.companyId,
      companyUserId: company.companyUserId,
      roleId: created.payload.data.id,
      assignedAt: now,
      assignedBy: company.companyUserId,
      revokedAt: null,
      revokedBy: null,
      revokedSeq: 0,
      createdAt: now,
      updatedAt: now,
    })

    const deleted = await call('/roles/main/delete', company.token, { id: created.payload.data.id })

    expect(deleted.status).toBe(409)
    expect(deleted.payload.code).toBe('300')
    expect(deleted.payload.errors[0]?.code).toBe(RoleErrorCode.InUse)
    expect(deleted.payload.errors[0]?.data?.['assignedUserCount']).toBe(1)

    // 訊息插值：`roles.main.errors.in-use` 的句子要真的長出那個數字。
    //
    // 斷言「有數字」而不是整句逐字比對：逐字比對會讓每一次潤稿都變成一支紅掉的測試，
    // 於是下一個人學會的是「改字要順手改測試」，而這一條真正要守的是**插值有沒有接上**
    // ——參數沒傳到的話，使用者看到的是一句留著 `{{assignedUserCount}}` 的訊息，
    // 而 `errors[].code` 與 `data` 都是對的，沒有任何一層會察覺。
    expect(deleted.payload.errors[0]?.msg).toContain('1')
    expect(deleted.payload.errors[0]?.msg).not.toContain('{{')
    // 頂層 `msg` 是 errors[0] 的複本（§1.3），插值參數必須跟著同一筆一起搬過去
    // ——只搬 key 不搬參數的話，這一句會留著括號，而 `errors[0].msg` 是好的。
    expect(deleted.payload.msg).toContain('1')
    expect(deleted.payload.msg).not.toContain('{{')
  })

  test('公司最後一個具管理能力的角色不可刪除、也不可停用', async () => {
    const company = await registerCompany()
    const created = await call<RoleDetailShape>('/roles/main/create', company.token, {
      code: uniqueCode('ADMIN'),
      name: '管理者',
      permissionIds: [requirePermissionId('roles.main.create')],
    })

    const deleted = await call('/roles/main/delete', company.token, { id: created.payload.data.id })
    expect(deleted.status).toBe(409)
    expect(deleted.payload.errors[0]?.code).toBe(RoleErrorCode.LastAdminRole)

    const deactivated = await call('/roles/main/deactivate', company.token, { id: created.payload.data.id })
    expect(deactivated.status).toBe(409)
    expect(deactivated.payload.errors[0]?.code).toBe(RoleErrorCode.LastAdminRole)
  })

  test('重複停用同一個角色，第二次回 role.state-changed', async () => {
    const company = await registerCompany()
    const created = await call<RoleDetailShape>('/roles/main/create', company.token, {
      code: uniqueCode('TOGGLE'),
      name: '可切換',
      permissionIds: [requirePermissionId('roles.main.list')],
    })

    const first = await call<RoleDetailShape>('/roles/main/deactivate', company.token, {
      id: created.payload.data.id,
    })
    expect(first.status).toBe(200)
    // 狀態動作端點必須回變更後的完整資源（§1.2）。
    expect(first.payload.data.status).toBe('INACTIVE')

    const second = await call('/roles/main/deactivate', company.token, { id: created.payload.data.id })
    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(RoleErrorCode.StateChanged)

    const reactivated = await call<RoleDetailShape>('/roles/main/activate', company.token, {
      id: created.payload.data.id,
    })
    expect(reactivated.status).toBe(200)
    expect(reactivated.payload.data.status).toBe('ACTIVE')
  })

  test('系統預設角色不可修改', async () => {
    const company = await registerCompany()
    const roleId = crypto.randomUUID()
    const now = clock.now()

    // §7.3 的例外：`is_system = true` 的角色**沒有任何正式流程造得出來**（`create` 端點
    // 一律寫 false，那是刻意的保護），只能直接寫入來製造這個前置狀態。
    await database.insert(roles).values({
      id: roleId,
      companyId: company.companyId,
      code: uniqueCode('SYSTEM'),
      name: '系統管理者',
      description: null,
      isSystem: true,
      status: 'ACTIVE',
      deletedAt: null,
      deletedSeq: 0,
      createdAt: now,
      updatedAt: now,
    })

    const updated = await call('/roles/main/update', company.token, {
      id: roleId,
      name: '改個名字',
      permissionIds: [requirePermissionId('roles.main.list')],
    })

    expect(updated.status).toBe(409)
    expect(updated.payload.code).toBe('300')
    expect(updated.payload.errors.map((error) => error.code)).toContain(RoleErrorCode.SystemRoleProtected)
  })

  /**
   * §3.2 ＋ §7.1：跨公司存取**不是獨立斷言一組期望值**，而是斷言它與「目標不存在」那一條的回應
   * 逐項相同。寫成兩組各自硬編的期望值時，日後有人改了其中一條的訊息，兩邊就悄悄分岔而測試依然全綠
   * ——那正是這條規則要防的事。
   */
  test('查詢類：以 B 公司身分讀 A 公司的角色，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<RoleDetailShape>('/roles/main/create', companyA.token, {
      code: uniqueCode('SECRET'),
      name: 'A 公司的角色',
      permissionIds: [requirePermissionId('roles.main.list')],
    })

    const crossCompany = await call('/roles/main/get', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/roles/main/get', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.payload.data).toBe(notFound.payload.data)
    // 查詢類的兩種情境都是 200 ＋ data: null（§3.1.3）。
    expect(crossCompany.status).toBe(200)
    expect(crossCompany.payload.data).toBeNull()
  })

  test('動作類：以 B 公司身分刪除 A 公司的角色，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<RoleDetailShape>('/roles/main/create', companyA.token, {
      code: uniqueCode('TARGET'),
      name: 'A 公司的角色',
      permissionIds: [requirePermissionId('roles.main.list')],
    })

    const crossCompany = await call('/roles/main/delete', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/roles/main/delete', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.status).toBe(422)
    expect(crossCompany.payload.errors[0]?.code).toBe(RoleErrorCode.NotFound)

    // 而且 A 公司的角色真的沒有被刪掉。
    const stillThere = await call<RoleDetailShape | null>('/roles/main/get', companyA.token, {
      id: created.payload.data.id,
    })
    expect(stillThere.payload.data).not.toBeNull()
  })
})
