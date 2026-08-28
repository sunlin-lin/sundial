/**
 * 登入狀態的端點測試（§7.1、§8 的第 19、32、48、50、51 條）。
 *
 * **從 HTTP 打進去，而且用的是真正的三個憑證驗證器與真正的資料庫**：本模組要測的東西
 * 幾乎沒有一項在 service 層測得到——輪替、偷用偵測、整條鏈作廢、即時撤銷全部是
 * 「上一個請求做過的事，會不會影響下一個請求」，而那只有跑完整條路徑才成立。
 * §7.3 也禁止 mock 掉被測邏輯本身，因此這裡**沒有任何身分驗證的替身**
 *（與 employees／roles 兩個模組的測試相反，那兩支用替身是因為當時 sessions 還不存在）。
 *
 * 斷言一律**同時檢查 HTTP status 與 envelope `code`**（§7.1）：只檢查其中一項會漏掉映射寫錯。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司代號與帳號，彼此看不到對方的資料，
 * 因此不需要 truncate，也不會產生「只在特定執行順序下失敗」的測試。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  companies,
  companyUserRoles,
  companyUsers,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  users,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { publicGuard } from '../../../../http/public-guard.ts'
import { refreshGuard } from '../../../../http/refresh-guard.ts'
import { REFRESH_TICKET_COOKIE_NAME } from '../../../../http/refresh-ticket-transport.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import { createAccessControlPorts, createRefreshControlPorts } from '../../../../app/session-access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import type { SessionConfig } from '../../../../shared/config.ts'
import { hashPassword } from '../domain/session-password.ts'
import { SessionErrorCode, SESSION_ENDPOINT_ERRORS } from '../sessions-main.errors.ts'
import {
  sessionsMainAuthenticatedRoutes,
  sessionsMainPublicRoutes,
  sessionsMainRefreshRoutes,
} from '../sessions-main.routes.ts'

/**
 * 直接讀環境變數組出資料庫設定，不走 `shared/config.ts`。
 *
 * `loadConfig()` 會一併要求 `FIELD_ENCRYPTION_KEYS`／`PORT` 這些與本測試完全無關的變數，
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

/**
 * 測試專用的簽章金鑰與壽命，**刻意不讀 `.env`**：測試要能在只設了資料庫連線的環境跑起來，
 * 而且金鑰換掉不該讓測試變紅——測試驗的是機制，不是某一把特定金鑰。
 */
const sessionConfig: SessionConfig = {
  accessTokenSecret: 'sessions-endpoint-test-secret',
  accessTokenTtlSeconds: 7200,
  refreshTokenTtlDays: 30,
}

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
  readonly exp: string | null
}

type LoginShape = {
  readonly accessToken: string
  readonly user: { readonly id: string; readonly companyUserId: string; readonly displayName: string }
  readonly company: { readonly id: string; readonly companyCode: string; readonly name: string }
}

type RefreshShape = { readonly accessToken: string }
type RevocationShape = { readonly ok: boolean }
type SessionContextShape = {
  readonly user: { readonly id: string; readonly companyUserId: string; readonly displayName: string }
  readonly company: { readonly id: string; readonly companyCode: string; readonly name: string }
  readonly permissionCodes: readonly string[]
}

let database: Database

/**
 * 與 `app/app.ts` 相同的中介層堆疊，**外加三個認證群組**（§1.9）。
 *
 * 逐字照抄組裝順序（error handler 包住全部、出口層與傳輸層在路由之前、每個群組各自掛自己的
 * 憑證驗證器），測到的才是正式環境真正會跑的那一條路徑。
 * **刻意在測試裡自己組，而不是呼叫 `buildApp()`**：本檔要驗的是「這三支端點各自落在哪一個
 * 認證群組」，而那正是 `app/routes.ts` 在做的決定。直接用組裝點的產物，等於拿受測對象自己
 * 當作期望值——群組掛錯（例如登入被掛進已登入群組）時，兩邊會一起錯，測試照樣綠。
 * 這裡逐字照抄它的順序與內容，兩者對不上時，紅的會是這裡。
 *
 * 三個群組各自的三元組（憑證來源, 憑證驗證器, 續期行為）寫在
 * `sessions-main.routes.ts` 的檔頭表格上。
 */
const buildTestApp = (db: Database) => {
  const dependencies = { db, clock, session: sessionConfig }
  const accessControl = createAccessControlPorts(dependencies)
  const refreshControl = createRefreshControlPorts(dependencies)

  return (
    new Elysia()
      .use(requestContext)
      .use(errorHandler(clock))
      .use(responseEnvelope(clock))
      // **刻意不在這裡掛 refresh 票的傳輸層**：那個 plugin 由 routes 自己帶進來
      //（見 `sessions-main.routes.ts` 的檔頭）。這裡不掛，測試順便證明了那件事
      // ——若 routes 沒帶，下面每一條 cookie 相關的斷言都會紅。
      .use(new Elysia({ name: 'test-public-group' }).use(publicGuard).use(sessionsMainPublicRoutes(dependencies)))
      .use(
        new Elysia({ name: 'test-refresh-group' })
          .use(refreshGuard(refreshControl))
          .use(sessionsMainRefreshRoutes(dependencies)),
      )
      .use(
        new Elysia({ name: 'test-authenticated-group' })
          .use(identityGuard(accessControl))
          .use(sessionsMainAuthenticatedRoutes(dependencies)),
      )
  )
}

let app: ReturnType<typeof buildTestApp>

/**
 * 收窄 `response.json()`（型別是 `unknown`）到 envelope 形狀。
 *
 * **刻意是一個真的會檢查的守衛，而不是一次型別斷言**（禁止用 `as` 硬轉）：
 * 這裡收的是 HTTP 邊界外的位元組，形狀本來就沒有任何靜態保證。
 */
const asEnvelope = <TData>(payload: unknown): payload is EnvelopeShape<TData> => {
  if (typeof payload !== 'object' || payload === null) return false
  const record: Record<string, unknown> = { ...payload }
  return typeof record['code'] === 'string' && typeof record['msg'] === 'string' && Array.isArray(record['errors'])
}

type CallOptions = {
  /** `Authorization: Bearer` 的值。不帶代表模擬「未登入」。 */
  readonly accessToken?: string
  /** 要送出的 refresh 票（模擬瀏覽器自動帶上 cookie）。 */
  readonly refreshTicket?: string
  readonly body?: Record<string, unknown>
}

type CallResult<TData> = {
  readonly status: number
  readonly payload: EnvelopeShape<TData>
  /** 原始的 `Set-Cookie` 標頭，供 cookie 屬性斷言（§5.4.3）。 */
  readonly setCookie: string | null
}

const call = async <TData>(path: string, options: CallOptions = {}): Promise<CallResult<TData>> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.accessToken !== undefined) headers['authorization'] = `Bearer ${options.accessToken}`
  if (options.refreshTicket !== undefined) {
    headers['cookie'] = `${REFRESH_TICKET_COOKIE_NAME}=${options.refreshTicket}`
  }

  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rqTS: clock.transportNow(),
        // `cmd` 由路徑機械推導（§1.3）：去掉開頭的 `/`、把剩下的 `/` 換成 `.`。
        // 測試自己也用同一條規則算，才不會變成「抄一份期望值」。
        cmd: path.replace(/^\//, '').replaceAll('/', '.'),
        locale: 'zh-TW',
        ...(options.body ?? {}),
      }),
    }),
  )

  const payload: unknown = await response.json()
  if (!asEnvelope<TData>(payload)) {
    throw new Error(`${path} 的回應不是 envelope 形狀（HTTP ${response.status}）：${JSON.stringify(payload)}`)
  }
  return { status: response.status, payload, setCookie: response.headers.get('set-cookie') }
}

/** 從 `Set-Cookie` 取出票的值，模擬瀏覽器收下它。 */
const readTicketFromCookie = (setCookie: string | null): string => {
  if (setCookie === null) throw new Error('回應沒有 Set-Cookie，refresh 票沒有被交付')
  const first = setCookie.split(';')[0] ?? ''
  const value = first.slice(first.indexOf('=') + 1)
  if (value === '') throw new Error(`Set-Cookie 沒有票的值：${setCookie}`)
  return value
}

const randomCode = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 20)

type Account = {
  readonly companyCode: string
  readonly username: string
  readonly password: string
  readonly companyId: string
  readonly userId: string
  readonly companyUserId: string
  readonly displayName: string
  readonly companyName: string
}

/**
 * 建立一家公司與一位可以登入的成員，並授予指定的權限碼。
 *
 * §7.3 的例外（規範要求註明理由）：`companies`／`users`／`company_users`／`roles`／
 * `role_permissions`／`company_user_roles` 這六張表**目前沒有任何可以從零開始走的正式流程**
 * ——`roles/main/create` 與 `company-users/roles/create` 都要求呼叫者**已經登入且已經有權限碼**，
 * 而那正是本測試要建立的東西（先有雞還是先有蛋）。因此開帳號這一步只能直接寫入。
 * **被測的那一段（登入、換票、登出）一行都沒有繞過**：測試從 HTTP 打進去，走完整條路徑。
 *
 * 密碼走本模組自己的 `hashPassword`，不是硬編一段 hash：硬編的話，
 * 哪天雜湊參數改了，測試會在「登入失敗」這個最難看出成因的地方紅掉。
 */
const registerAccount = async (grantedPermissionCodes: readonly string[] = []): Promise<Account> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const companyCode = randomCode()
  const username = `user-${randomCode()}`
  const password = `pw-${crypto.randomUUID()}`
  const companyName = `測試公司-${companyCode.slice(0, 8)}`
  const now = clock.now()

  await database.insert(companies).values({
    id: companyId,
    companyCode,
    companyType: 'COMPANY',
    legalType: 'LIMITED_COMPANY',
    taxId: null,
    name: companyName,
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
    username,
    passwordHash: await hashPassword(password),
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

  if (grantedPermissionCodes.length > 0) {
    const roleId = crypto.randomUUID()
    await database.insert(roles).values({
      id: roleId,
      companyId,
      code: `ROLE-${randomCode().slice(0, 10)}`,
      name: '測試角色',
      description: null,
      isSystem: false,
      status: 'ACTIVE',
      deletedAt: null,
      deletedSeq: 0,
      createdAt: now,
      updatedAt: now,
    })

    // 權限碼由 migration seed 建立（0001–0003、0008）：測試**查它們的 id 而不是硬編**，
    // 否則 seed 的 UUID 一改，這裡就會以「使用者沒有權限」的形式失敗，而成因看不出來。
    const granted = await database
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(inArray(permissions.code, [...grantedPermissionCodes]), eq(permissions.deletedSeq, 0)))

    if (granted.length !== grantedPermissionCodes.length) {
      throw new Error(
        `權限碼 seed 不完整：期望 ${grantedPermissionCodes.length} 筆，實際查到 ${granted.length} 筆（${grantedPermissionCodes.join('、')}）`,
      )
    }

    await database
      .insert(rolePermissions)
      .values(granted.map((permission) => ({ companyId, roleId, permissionId: permission.id, createdAt: now })))

    await database.insert(companyUserRoles).values({
      id: crypto.randomUUID(),
      companyId,
      companyUserId,
      roleId,
      assignedAt: now,
      assignedBy: companyUserId,
      revokedAt: null,
      revokedBy: null,
      revokedSeq: 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  return {
    companyCode,
    username,
    password,
    companyId,
    userId,
    companyUserId,
    // 沒有綁員工的成員以帳號當顯示名稱（見 find-profile）。
    displayName: username,
    companyName,
  }
}

/** 兩支登出端點都需要權限碼（§5.2.2：權限碼由路徑機械推導，沒有例外分支）。 */
const LOGOUT_PERMISSIONS = ['sessions.main.logout', 'sessions.main.logout-all'] as const

const loginAs = async (account: Account) => {
  const response = await call<LoginShape>('/sessions/main/login', {
    body: { companyCode: account.companyCode, username: account.username, password: account.password },
  })
  if (response.status !== 200) {
    throw new Error(`登入失敗（HTTP ${response.status}）：${JSON.stringify(response.payload)}`)
  }
  return { accessToken: response.payload.data.accessToken, refreshTicket: readTicketFromCookie(response.setCookie) }
}

/** 端點宣告的錯誤碼清單（§1.8.3）：測試中斷言到的碼必須落在裡面。 */
const declaredLoginCodes = SESSION_ENDPOINT_ERRORS.login.map((declaration) => declaration.code)

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('sessions/main endpoints：登入（integration）', () => {
  test('登入成功回 200／200，data 含 accessToken、user 與 company，且 expiresIn 等於完整壽命', async () => {
    const account = await registerAccount()

    const response = await call<LoginShape>('/sessions/main/login', {
      body: { companyCode: account.companyCode, username: account.username, password: account.password },
    })

    expect(response.status).toBe(200)
    expect(response.payload.code).toBe('200')
    expect(response.payload.errors).toEqual([])
    expect(response.payload.data.accessToken).not.toBe('')
    expect(response.payload.data.user.id).toBe(account.userId)
    expect(response.payload.data.user.companyUserId).toBe(account.companyUserId)
    expect(response.payload.data.user.displayName).toBe(account.displayName)
    expect(response.payload.data.company.id).toBe(account.companyId)
    expect(response.payload.data.company.companyCode).toBe(account.companyCode)
    expect(response.payload.data.company.name).toBe(account.companyName)

    // §8 第 19 條：發證端點成功時 `expiresIn` 必須等於設定的完整壽命秒數（不是續期後的剩餘秒數）。
    expect(response.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)
    expect(response.payload.exp).toBe('2026-08-27T14:00:00+08:00')

    // envelope 的尾段由出口層補上（§1.8.2），handler 一個字都沒填。
    expect(response.payload.cmd).toBe('sessions.main.login')
    expect(response.payload.locale).toBe('zh-TW')
  })

  /**
   * §5.4.3：refresh token 存 **httpOnly + Secure + SameSite=Lax** cookie。
   *
   * §8 末段把「cookie 屬性是否確實帶上」列為「沒有自動化檢查的規則」之一，因此這條測試就是那道檢查。
   * 三個屬性各自擋掉一件事，一個都不能少（見 `http/refresh-ticket-transport.ts`）。
   */
  test('refresh 票走 httpOnly + Secure + SameSite=Lax cookie，且不出現在 response body', async () => {
    const account = await registerAccount()
    const response = await call<LoginShape>('/sessions/main/login', {
      body: { companyCode: account.companyCode, username: account.username, password: account.password },
    })

    const setCookie = response.setCookie
    if (setCookie === null) throw new Error('登入成功卻沒有交付 refresh 票')

    expect(setCookie.startsWith(`${REFRESH_TICKET_COOKIE_NAME}=`)).toBe(true)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`)

    // §5.4.3：兩張票不可能同時落入同一個 XSS payload——refresh 票絕對不能出現在 response body，
    // 放進去的那一刻 `httpOnly` 就等於沒有設。
    const ticket = readTicketFromCookie(setCookie)
    expect(JSON.stringify(response.payload)).not.toContain(ticket)
  })

  test('DB 裡存的是票的 hash，不是原值（§5.4.3）', async () => {
    const account = await registerAccount()
    const session = await loginAs(account)

    const stored = await database
      .select({ tokenHash: refreshTokens.tokenHash })
      .from(refreshTokens)
      .where(eq(refreshTokens.companyId, account.companyId))

    expect(stored).toHaveLength(1)
    // BINARY(32) ＝ SHA-256 的長度。
    expect(stored[0]?.tokenHash.byteLength).toBe(32)
    // 整張表裡找不到票的原值。用 latin1 逐位元組比對，理由同 employees 的密文測試。
    expect(stored[0]?.tokenHash.toString('latin1')).not.toContain(session.refreshTicket)
  })

  /**
   * §3.2 ＋ §8 第 32 條：登入失敗的四種原因**回應必須逐項相同**。
   *
   * **刻意比對四個實際回應彼此相等，而不是各自硬編一組期望值**——硬編的話，
   * 日後有人改了其中一條的訊息，兩邊就悄悄分岔而測試依然全綠，那正是這條規則要防的事。
   */
  test('登入失敗的四種原因，回應逐項完全相同', async () => {
    const accountA = await registerAccount()
    const accountB = await registerAccount()

    const attempt = (body: Record<string, unknown>) => call<null>('/sessions/main/login', { body })

    const responses = await Promise.all([
      // ① 公司代號不存在
      attempt({ companyCode: randomCode(), username: accountA.username, password: accountA.password }),
      // ② 帳號不存在
      attempt({ companyCode: accountA.companyCode, username: `user-${randomCode()}`, password: accountA.password }),
      // ③ 密碼錯誤
      attempt({ companyCode: accountA.companyCode, username: accountA.username, password: 'definitely-wrong' }),
      // ④ 該帳號不屬於這家公司（B 的帳號配 A 的公司代號，密碼是對的）
      attempt({ companyCode: accountA.companyCode, username: accountB.username, password: accountB.password }),
    ])

    const [baseline] = responses
    if (baseline === undefined) throw new Error('四種登入失敗案例沒有跑到')

    for (const response of responses) {
      expect(response.status).toBe(baseline.status)
      expect(response.payload.code).toBe(baseline.payload.code)
      expect(response.payload.msg).toBe(baseline.payload.msg)
      expect(response.payload.errors).toEqual(baseline.payload.errors)
      expect(response.payload.data).toBe(baseline.payload.data)
    }

    // 而那個共同的回應必須是 422／`300`，**不是 `900`**（§1.3）：使用者已經在登入頁了，
    // 「導向登入頁」對他不是一個動作——回 `900` 會讓前端清掉狀態並重新導向，
    // 錯誤訊息在導向過程中被清掉，他不會知道自己打錯了什麼。
    expect(baseline.status).toBe(422)
    expect(baseline.payload.code).toBe('300')
    expect(baseline.payload.errors[0]?.code).toBe(SessionErrorCode.InvalidCredentials)
    expect(declaredLoginCodes).toContain(SessionErrorCode.InvalidCredentials)
    // 公開端點未發證時 `expiresIn` 為 `null`（§1.3）。
    expect(baseline.payload.expiresIn).toBeNull()

    // §3.2：訊息不得回聲任何可用於枚舉的值。
    const serialized = JSON.stringify(baseline.payload)
    expect(serialized).not.toContain(accountA.companyCode)
    expect(serialized).not.toContain(accountA.username)
    expect(serialized).not.toContain(accountB.username)
  })

  test('公司被停用後登入失敗，且回應與「公司不存在」逐項相同', async () => {
    const account = await registerAccount()
    // §7.3 的例外：公司停用目前沒有對應的正式流程（`companies` 的維護端點尚未存在）。
    await database.update(companies).set({ status: 'INACTIVE' }).where(eq(companies.id, account.companyId))

    const disabled = await call<null>('/sessions/main/login', {
      body: { companyCode: account.companyCode, username: account.username, password: account.password },
    })
    const missing = await call<null>('/sessions/main/login', {
      body: { companyCode: randomCode(), username: account.username, password: account.password },
    })

    expect(disabled.status).toBe(missing.status)
    expect(disabled.payload.code).toBe(missing.payload.code)
    expect(disabled.payload.msg).toBe(missing.payload.msg)
    expect(disabled.payload.errors).toEqual(missing.payload.errors)
  })
})

describe('sessions/main endpoints：換票與偷用偵測（integration）', () => {
  test('輪替：舊票立刻作廢、新票可用，且兩張票不同', async () => {
    const account = await registerAccount()
    const first = await loginAs(account)

    const rotated = await call<RefreshShape>('/sessions/main/refresh', { refreshTicket: first.refreshTicket })
    expect(rotated.status).toBe(200)
    expect(rotated.payload.code).toBe('200')
    // 發證端點：`expiresIn` 是新票的完整壽命（§1.3 來源②），不是續期後的剩餘秒數。
    expect(rotated.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)

    const secondTicket = readTicketFromCookie(rotated.setCookie)
    expect(secondTicket).not.toBe(first.refreshTicket)
    expect(rotated.payload.data.accessToken).not.toBe(first.accessToken)

    // 新票可以再換一次。
    const again = await call<RefreshShape>('/sessions/main/refresh', { refreshTicket: secondTicket })
    expect(again.status).toBe(200)
    expect(again.payload.code).toBe('200')
  })

  /**
   * §5.4.2 ＋ §8 第 48 條：**已作廢的 refresh token 再次使用 → 該使用者全鏈作廢、後續請求一律 `900`**。
   *
   * 這是本系統偵測「票被偷」的唯一防線（§5.4.4 明確記錄了不做敏感操作重新驗證的決定），
   * 因此這條測試涵蓋的是三件事，缺一不可：舊票被拒、**最新的票也一起死**、access token 即時失效。
   */
  test('偷用偵測：以已作廢的票換票 → 該成員的所有票全鏈作廢，且 access token 立刻失效', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const first = await loginAs(account)

    // 正常輪替一次：T1 作廢、T2 生效。
    const rotated = await call<RefreshShape>('/sessions/main/refresh', { refreshTicket: first.refreshTicket })
    const secondTicket = readTicketFromCookie(rotated.setCookie)
    const secondAccessToken = rotated.payload.data.accessToken

    // 攻擊者（或落後的分頁）拿 T1 再換一次。
    const reused = await call<null>('/sessions/main/refresh', { refreshTicket: first.refreshTicket })
    expect(reused.status).toBe(401)
    expect(reused.payload.code).toBe('900')
    // §1.9.1 的固定形狀：`900` 一律 `expiresIn: null` ＋ `errors: []`。
    expect(reused.payload.expiresIn).toBeNull()
    expect(reused.payload.errors).toEqual([])

    // **不是只擋下這一次請求，是整條鏈（所有鏈）作廢**：最新的 T2 也不能用了。
    const afterDetection = await call<null>('/sessions/main/refresh', { refreshTicket: secondTicket })
    expect(afterDetection.status).toBe(401)
    expect(afterDetection.payload.code).toBe('900')

    // §5.4.6：**當下生效**，不是「等 access token 自己過期」——手上仍在有效期內的兩張 access token
    // 在下一個請求就必須回 `900`。
    for (const accessToken of [first.accessToken, secondAccessToken]) {
      const blocked = await call<null>('/sessions/main/logout', { accessToken })
      expect(blocked.status).toBe(401)
      expect(blocked.payload.code).toBe('900')
      expect(blocked.payload.expiresIn).toBeNull()
    }
  })

  test('偷用偵測會作廢該成員的其他登入（另一台裝置），但不影響別人', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const other = await registerAccount(LOGOUT_PERMISSIONS)

    const deviceA = await loginAs(account)
    const deviceB = await loginAs(account)
    const stranger = await loginAs(other)

    // A 裝置輪替一次，然後拿舊票再用一次 → 觸發偷用偵測。
    await call<RefreshShape>('/sessions/main/refresh', { refreshTicket: deviceA.refreshTicket })
    await call<null>('/sessions/main/refresh', { refreshTicket: deviceA.refreshTicket })

    // B 裝置（同一位成員的另一條鏈）也被作廢了。
    const deviceBBlocked = await call<null>('/sessions/main/logout', { accessToken: deviceB.accessToken })
    expect(deviceBBlocked.status).toBe(401)
    expect(deviceBBlocked.payload.code).toBe('900')

    // 別人的 session 完全不受影響。
    const strangerOk = await call<RevocationShape>('/sessions/main/logout', { accessToken: stranger.accessToken })
    expect(strangerOk.status).toBe(200)
    expect(strangerOk.payload.code).toBe('200')
  })

  test('沒帶 refresh 票時回 401／900，形狀與帶了一張假票完全相同', async () => {
    const missing = await call<null>('/sessions/main/refresh')
    const forged = await call<null>('/sessions/main/refresh', { refreshTicket: 'not.a.real.ticket' })

    for (const response of [missing, forged]) {
      expect(response.status).toBe(401)
      expect(response.payload.code).toBe('900')
      expect(response.payload.expiresIn).toBeNull()
      expect(response.payload.exp).toBeNull()
      expect(response.payload.errors).toEqual([])
    }
    expect(missing.payload.msg).toBe(forged.payload.msg)
  })

  /** §5.4.1：refresh 票只認一個端點——拿它當 access token 用一律被拒。 */
  test('refresh 票不能當 access token 用', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const session = await loginAs(account)

    const misused = await call<null>('/sessions/main/logout', { accessToken: session.refreshTicket })
    expect(misused.status).toBe(401)
    expect(misused.payload.code).toBe('900')
  })
})

describe('sessions/main endpoints：登出（integration）', () => {
  test('登出成功回 200／200 與 ok:true，expiresIn 為 null，且票被收回', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const session = await loginAs(account)

    const response = await call<RevocationShape>('/sessions/main/logout', { accessToken: session.accessToken })

    expect(response.status).toBe(200)
    expect(response.payload.code).toBe('200')
    expect(response.payload.data.ok).toBe(true)
    // §8 第 19 條：**登出成功必須為 `null`**——本次回應之後客戶端手上沒有有效的 access token。
    // 驗證器在②的時候已經續期過了，這一格是 handler 主動清掉的（§1.3）。
    expect(response.payload.expiresIn).toBeNull()
    expect(response.payload.exp).toBeNull()

    // 客戶端手上那份副本也被收回（Max-Age=0），屬性與發票時相同。
    const setCookie = response.setCookie
    if (setCookie === null) throw new Error('登出沒有收回 refresh 票')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
  })

  /**
   * §5.4.6 ＋ §8 第 50 條：**撤銷後的下一個請求即回 `900`**，
   * 而且是持著**同一張仍在有效期內**的 access token——不得先成功再失敗。
   *
   * 這條測試存在的理由是 §5.4.6 的第三個論證：一個只在正式環境成立、
   * 且無法被測試證偽的安全行為，等於沒有這個行為。
   */
  test('登出後，持同一張仍在有效期內的 access token 的下一個請求即回 900', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const session = await loginAs(account)

    // 登出前，同一張票是好用的。
    const before = await call<RevocationShape>('/sessions/main/logout-all', { accessToken: session.accessToken })
    expect(before.status).toBe(200)

    // 登出（logout-all 已經作廢了鏈，這裡再確認一次同一張票的下一個請求就是 `900`）。
    const after = await call<null>('/sessions/main/logout', { accessToken: session.accessToken })
    expect(after.status).toBe(401)
    expect(after.payload.code).toBe('900')
    expect(after.payload.expiresIn).toBeNull()
  })

  /**
   * §5.4.7 ＋ §8 第 51 條的驗收：**以鏈中的舊票登出後，最新票也失效**。
   *
   * 情境是多分頁——本系統的日常：A 分頁已經換票到 T4，B 分頁手上還是舊的那一段。
   * B 分頁按下登出時，只作廢單張的做法廢掉的是早就失效的舊票、而 T4 還活著：
   * 畫面乾淨地回到登入頁，**session 卻沒有斷**。這條測試就是在守那件事。
   */
  test('以鏈中的舊票登出，最新的 refresh 票與 access token 一併失效', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)

    // T1：登入。B 分頁停在這一段（手上是 T1 與它的 access token）。
    const stale = await loginAs(account)

    // A 分頁一路換到 T4。
    let ticket = stale.refreshTicket
    let latestAccessToken = stale.accessToken
    for (let round = 0; round < 3; round += 1) {
      const rotated = await call<RefreshShape>('/sessions/main/refresh', { refreshTicket: ticket })
      expect(rotated.status).toBe(200)
      ticket = readTicketFromCookie(rotated.setCookie)
      latestAccessToken = rotated.payload.data.accessToken
    }

    // B 分頁（拿著鏈中最舊那一段的 access token）按下登出。
    const loggedOut = await call<RevocationShape>('/sessions/main/logout', { accessToken: stale.accessToken })
    expect(loggedOut.status).toBe(200)
    expect(loggedOut.payload.code).toBe('200')

    // 最新的 T4 也失效了——這正是「作廢整條鏈」與「只作廢手上那一張」的差別。
    const withLatestTicket = await call<null>('/sessions/main/refresh', { refreshTicket: ticket })
    expect(withLatestTicket.status).toBe(401)
    expect(withLatestTicket.payload.code).toBe('900')

    // 而且該 session 的 access token 後續請求一律 `900`（§5.4.6）。
    const withLatestAccessToken = await call<null>('/sessions/main/logout', { accessToken: latestAccessToken })
    expect(withLatestAccessToken.status).toBe(401)
    expect(withLatestAccessToken.payload.code).toBe('900')
  })

  test('logout-all 作廢本人所有裝置（含當前這台），但不影響別人', async () => {
    const account = await registerAccount(LOGOUT_PERMISSIONS)
    const other = await registerAccount(LOGOUT_PERMISSIONS)

    const deviceA = await loginAs(account)
    const deviceB = await loginAs(account)
    const stranger = await loginAs(other)

    const response = await call<RevocationShape>('/sessions/main/logout-all', { accessToken: deviceA.accessToken })
    expect(response.status).toBe(200)
    expect(response.payload.data.ok).toBe(true)
    expect(response.payload.expiresIn).toBeNull()

    // 另一台裝置立刻失效（§5.4.6：當下生效）。
    const deviceBBlocked = await call<null>('/sessions/main/logout', { accessToken: deviceB.accessToken })
    expect(deviceBBlocked.status).toBe(401)
    expect(deviceBBlocked.payload.code).toBe('900')

    // **含當前這台裝置，沒有例外**（比照 §5.4.5 對改密碼的要求）。
    const deviceABlocked = await call<null>('/sessions/main/logout', { accessToken: deviceA.accessToken })
    expect(deviceABlocked.status).toBe(401)
    expect(deviceABlocked.payload.code).toBe('900')

    // 別人的 session 完全不受影響——作廢範圍是「這位成員」而不是「這家公司」。
    const strangerOk = await call<RevocationShape>('/sessions/main/logout', { accessToken: stranger.accessToken })
    expect(strangerOk.status).toBe(200)
  })

  test('未帶 token 一律回 401／900，且 expiresIn 為 null（§1.3）', async () => {
    const response = await call<null>('/sessions/main/logout')

    expect(response.status).toBe(401)
    expect(response.payload.code).toBe('900')
    expect(response.payload.expiresIn).toBeNull()
    expect(response.payload.errors).toEqual([])
  })

  /**
   * §7.1：每個端點至少一條「無權限角色被 403」的測試，且 §1.3 要求 `901` 必須回**續期後**的
   * `expiresIn`（非 `null`）。
   *
   * 後者特別容易寫錯：直覺上「被拒絕」看起來像失敗，於是不續期——但那正是最不該的，
   * 使用者點到一個沒權限的功能等於順便把自己的 session 熬短，下一次真正有權限的操作反而吃到 `900`。
   */
  test('沒有 sessions.main.logout 權限碼的成員被 403／901，且 expiresIn 仍是續期後的正數', async () => {
    // 刻意不授予任何權限碼：登入不需要權限（公開群組），但登出需要（§5.2.2）。
    const account = await registerAccount()
    const session = await loginAs(account)

    const response = await call<null>('/sessions/main/logout', { accessToken: session.accessToken })

    expect(response.status).toBe(403)
    expect(response.payload.code).toBe('901')
    expect(response.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)
    // `901` 依 §1.3 一律不帶 errors：前端對它的處置只有一種（顯示無權限），細節只進 log。
    expect(response.payload.errors).toEqual([])

    // 另兩支已登入群組的端點同樣被擋（§7.1 要求每個端點都有一條無權限案例）：
    // `context` 與 `logout`／`logout-all` 是同一條規則的落點——權限碼由路徑機械推導，
    // 沒有「這支特殊」的例外分支（§5.2.2）。
    const logoutAll = await call<null>('/sessions/main/logout-all', { accessToken: session.accessToken })
    expect(logoutAll.status).toBe(403)
    expect(logoutAll.payload.code).toBe('901')
    expect(logoutAll.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)

    const context = await call<null>('/sessions/main/context', { accessToken: session.accessToken })
    expect(context.status).toBe(403)
    expect(context.payload.code).toBe('901')
    expect(context.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)

    // 身分仍然有效：refresh 照樣可以換票（被拒的只是那一個動作）。
    const stillAlive = await call<RefreshShape>('/sessions/main/refresh', {
      refreshTicket: (await loginAs(account)).refreshTicket,
    })
    expect(stillAlive.status).toBe(200)
  })

  test('偽造的 access token 被拒（簽章真的有在驗）', async () => {
    const response = await call<null>('/sessions/main/logout', { accessToken: 'forged.token' })
    expect(response.status).toBe(401)
    expect(response.payload.code).toBe('900')
  })
})

/**
 * `POST /sessions/main/context`（任務三）：重新整理會掉線、前端拿不到權限碼，這兩個症狀的解法。
 */
describe('sessions/main/context（integration，任務三）', () => {
  test('回身分與這個成員實際擁有的權限碼，且與登入回應的 user／company 一致', async () => {
    const grantedCodes = ['sessions.main.context', 'sessions.main.logout']
    const account = await registerAccount(grantedCodes)
    const session = await loginAs(account)

    const response = await call<SessionContextShape>('/sessions/main/context', { accessToken: session.accessToken })

    expect(response.status).toBe(200)
    expect(response.payload.code).toBe('200')
    expect(response.payload.errors).toEqual([])
    // `context` 通過的是已登入群組的憑證驗證器，因此照常續期（不是發證，§1.3）。
    expect(response.payload.expiresIn).toBe(sessionConfig.accessTokenTtlSeconds)

    const data = response.payload.data
    expect(data.user).toEqual({
      id: account.userId,
      companyUserId: account.companyUserId,
      displayName: account.displayName,
    })
    expect(data.company).toEqual({ id: account.companyId, companyCode: account.companyCode, name: account.companyName })

    // **這個成員實際擁有的權限碼**，不是全部權限碼清單（任務三）：只有這兩碼被授予，
    // 且輸出已排序（見 handler 的 `toSessionContextData`）。
    expect(data.permissionCodes).toEqual([...grantedCodes].toSorted())
  })

  test('只授予 context 本身：permissionCodes 恰好一筆，不多不少', async () => {
    // `context` 本身也需要權限碼（§5.2.2），因此不能測「完全沒有權限碼」的情境——
    // 那會在進 handler 之前就被擋成 403（見上面「沒有 sessions.main.logout 權限碼」那一條）。
    // 這裡驗證的是另一件事：只授予這一碼時，`permissionCodes` 恰好回這一筆，
    // 不會多出、也不會漏掉——不是靠巧合對上，而是真的查了這個成員實際擁有的集合。
    const account = await registerAccount(['sessions.main.context'])
    const session = await loginAs(account)

    const response = await call<SessionContextShape>('/sessions/main/context', { accessToken: session.accessToken })

    expect(response.status).toBe(200)
    expect(response.payload.data.permissionCodes).toEqual(['sessions.main.context'])
  })

  test('未帶 token 一律回 401／900，且 expiresIn 為 null', async () => {
    const response = await call<null>('/sessions/main/context')
    expect(response.status).toBe(401)
    expect(response.payload.code).toBe('900')
    expect(response.payload.expiresIn).toBeNull()
  })
})
