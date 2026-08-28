/**
 * 員工主檔的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射、以及個資有沒有真的被遮罩——那些全部發生在
 * handler 與邊界層，繞過它們就等於沒測到。斷言一律**同時檢查 HTTP status 與 `code`**（§7.1）。
 *
 * 本檔沒有寫「無權限角色被 403」那一條（§7.1 的第三條）：權限碼的授予要靠
 * `company-users/roles` 模組與 `sessions` 模組，那兩個模組尚未落地，硬寫出來只會是在測
 * 本檔自己的假資料（與 `roles-main.endpoints.test.ts` 的處置相同）。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的員工，
 * 因此不需要 truncate，也不會產生「只在特定執行順序下失敗」的測試。
 */
import { Buffer } from 'node:buffer'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { createFieldCipher, createKeyRing, ENCRYPTION_KEY_BYTE_LENGTH } from '../../../../db/field-encryption.ts'
import { companies, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { EmployeeErrorCode, EMPLOYEE_ENDPOINT_ERRORS, type EmployeeErrorDeclaration } from '../employees-main.errors.ts'
import { employeesMainRoutes } from '../employees-main.routes.ts'

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

/**
 * 測試專用的金鑰，**刻意不讀 `.env` 的開發金鑰**：測試要能在只設了資料庫連線的環境跑起來，
 * 而且金鑰換掉不該讓測試變紅——測試驗的是「明文沒有進資料庫」，不是某一把特定金鑰。
 */
const testKey = (seed: number): string => Buffer.alloc(ENCRYPTION_KEY_BYTE_LENGTH, seed).toString('base64')
const cipher = createFieldCipher(
  createKeyRing({ keys: `v1:${testKey(21)}`, activeKeyId: 'v1', blindIndexKey: testKey(22) }),
)

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

type EmployeeDetailShape = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly gender: string
  readonly identityNumberMasked: string
  readonly birthdayMasked: string
  readonly phoneMasked: string
  readonly emailMasked: string | null
  readonly addressMasked: string
}

type EmployeeListShape = {
  readonly search: Record<string, unknown>
  readonly sort: { readonly field: string; readonly order: string }
  readonly pagination: { readonly currentPage: number; readonly perPage: number; readonly totalCount: number }
  readonly data: readonly {
    readonly id: string
    readonly employeeCode: string
    readonly identityNumberMasked: string
  }[]
}

/** 每個 token 對應一個已驗證身分。測試以此模擬「不同公司的使用者」。 */
const identityByToken = new Map<string, VerifiedIdentity>()

/**
 * 身分驗證的替身。
 *
 * §7.3 禁止 mock 掉**被測邏輯本身**，而 token 驗證與權限查詢屬於 `sessions`／`company-users`
 * 兩個尚未落地的模組——它們不是本檔要測的東西。
 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'employees.main.list',
        'employees.main.get',
        'employees.main.create',
        'employees.main.update',
        'employees.main.delete',
      ]),
    ),
}

/**
 * 與 `app/app.ts` 相同的中介層堆疊。
 *
 * 逐字照抄組裝順序（error handler 包住全部、出口層在路由之前、認證群組包住端點），
 * 測到的才是正式環境真正會跑的那一條路徑。**目前只能在測試裡自己組**：骨架的
 * `app/routes.ts` 尚未把業務模組掛上去，且 `AppDependencies` 沒有資料庫欄位
 * （與 roles 模組的處置相同，已寫進交付回報）。
 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(employeesMainRoutes({ db, cipher, clock })),
    )

let database: Database
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
const registerCompany = async (): Promise<{ companyId: string; token: string }> => {
  const companyId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = clock.now()

  // §7.3 的例外：`companies`、`users` 與 `company_users` 目前**沒有任何正式流程**可以建立
  //（那幾個模組尚未落地），只能直接寫入。註明理由是規範的要求，不是慣例。
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

/** 端點宣告的錯誤碼清單（§1.8.3）：測試中斷言到的碼必須落在裡面。 */
const declaredCodes = (declarations: readonly EmployeeErrorDeclaration[]): readonly string[] =>
  declarations.map((declaration) => declaration.code)

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

/**
 * 產生一個「同一次測試執行內不會相撞」的身分證號。
 *
 * 格式必須通過 routes 的 `IdentityNumber` 樣式（首字英文、次字英數、後 8 碼數字）。
 * 用亂數而不是固定值：身分證在公司內是唯一鍵，固定值會讓兩條測試互相影響（§7.4）。
 */
const uniqueIdentityNumber = (): string =>
  `A${Math.floor(Math.random() * 900_000_000 + 100_000_000)
    .toString()
    .padStart(9, '1')}`

const profileBody = (overrides: Record<string, unknown> = {}) => ({
  employeeCode: uniqueCode('EMP'),
  name: '王小明',
  gender: 'MALE',
  identityNumber: uniqueIdentityNumber(),
  birthday: '1990-05-21',
  phone: '0912345678',
  email: 'someone@example.com',
  address: '台北市信義區信義路五段7號',
  ...overrides,
})

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employees/main endpoints (integration)', () => {
  test('建立員工成功，敏感欄位一律遮罩，並能由 get 與 list 讀回', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)

    expect(created.status).toBe(200)
    expect(created.payload.code).toBe('200')
    expect(created.payload.errors).toEqual([])
    expect(created.payload.data.employeeCode).toBe(body.employeeCode)
    expect(created.payload.data.name).toBe('王小明')
    expect(created.payload.data.gender).toBe('MALE')

    // §5.1：對外回應一律遮罩，完整值不在任何端點提供。
    expect(created.payload.data.identityNumberMasked).toBe(`*******${body.identityNumber.slice(-3)}`)
    expect(created.payload.data.birthdayMasked).toBe('1990-**-**')
    expect(created.payload.data.phoneMasked).toBe('*******678')
    expect(created.payload.data.emailMasked).toBe('s***@example.com')
    expect(created.payload.data.addressMasked).toBe('台北市信義區***')

    // 整包回應裡找不到任何一段明文。
    const serialized = JSON.stringify(created.payload)
    expect(serialized).not.toContain(body.identityNumber)
    expect(serialized).not.toContain('1990-05-21')
    expect(serialized).not.toContain('0912345678')
    expect(serialized).not.toContain('someone@example.com')
    expect(serialized).not.toContain('信義路五段')

    // envelope 的尾段由出口層補上（§1.8.2），handler 一個字都沒填。
    expect(created.payload.cmd).toBe('employees.main.create')
    expect(created.payload.locale).toBe('zh-TW')
    expect(created.payload.expiresIn).toBe(7200)

    const fetched = await call<EmployeeDetailShape | null>('/employees/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.status).toBe(200)
    expect(fetched.payload.data?.name).toBe('王小明')
    expect(fetched.payload.data?.identityNumberMasked).toBe(created.payload.data.identityNumberMasked)

    const listed = await call<EmployeeListShape>('/employees/main/list', company.token, {
      keyword: body.employeeCode,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.pagination.totalCount).toBe(1)
    expect(listed.payload.data.data[0]?.id).toBe(created.payload.data.id)
    expect(listed.payload.data.data[0]?.identityNumberMasked).toBe(created.payload.data.identityNumberMasked)
    // `search` 與 `sort` 必須原樣回聲（§1.4）；沒送 sort 時回的是實際生效的預設值。
    expect(listed.payload.data.search).toEqual({ keyword: body.employeeCode })
    expect(listed.payload.data.sort).toEqual({ field: 'employeeCode', order: 'asc' })
  })

  test('資料庫裡存的是密文：明文一段都找不到，且同一個明文兩次寫入的位元組不同', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)
    const [row] = await database
      .select({
        identityNumberEncrypted: employees.identityNumberEncrypted,
        identityNumberHash: employees.identityNumberHash,
        birthdayEncrypted: employees.birthdayEncrypted,
        phoneEncrypted: employees.phoneEncrypted,
        emailEncrypted: employees.emailEncrypted,
        addressEncrypted: employees.addressEncrypted,
      })
      .from(employees)
      .where(eq(employees.id, created.payload.data.id))

    if (row === undefined) throw new Error('剛建立的員工在資料庫裡找不到')

    // `latin1` 是逐位元組轉字元，不會像 utf8 那樣把不合法序列換成 U+FFFD——
    // 用 utf8 比對會讓這條測試在明文其實還在的情況下也通過。
    const stored = Buffer.concat([
      row.identityNumberEncrypted,
      row.identityNumberHash,
      row.birthdayEncrypted,
      row.phoneEncrypted,
      row.emailEncrypted ?? Buffer.alloc(0),
      row.addressEncrypted,
    ]).toString('latin1')

    expect(stored).not.toContain(body.identityNumber)
    expect(stored).not.toContain('1990-05-21')
    expect(stored).not.toContain('0912345678')
    expect(stored).not.toContain('someone@example.com')
    // 地址是中文，先轉成同一種逐位元組表示再比對。
    expect(stored).not.toContain(Buffer.from(body.address, 'utf8').toString('latin1'))

    // blind index 是固定長度（DB 端 BINARY(32)）。
    expect(row.identityNumberHash.byteLength).toBe(32)

    // 同一個明文在另一家公司再寫一次，密文位元組必然不同（隨機 IV），而 hash 必然相同。
    const otherCompany = await registerCompany()
    const twin = await call<EmployeeDetailShape>('/employees/main/create', otherCompany.token, body)
    const [twinRow] = await database
      .select({
        identityNumberEncrypted: employees.identityNumberEncrypted,
        identityNumberHash: employees.identityNumberHash,
      })
      .from(employees)
      .where(eq(employees.id, twin.payload.data.id))

    if (twinRow === undefined) throw new Error('第二家公司的員工在資料庫裡找不到')
    expect(twinRow.identityNumberEncrypted.equals(row.identityNumberEncrypted)).toBe(false)
    expect(twinRow.identityNumberHash.equals(row.identityNumberHash)).toBe(true)
  })

  test('查無資料的清單回空陣列與正確的 pagination，不是錯誤', async () => {
    const company = await registerCompany()

    const listed = await call<EmployeeListShape>('/employees/main/list', company.token, {
      keyword: '不存在的關鍵字',
      perPage: 20,
      currentPage: 1,
    })

    expect(listed.status).toBe(200)
    expect(listed.payload.code).toBe('200')
    expect(listed.payload.data.data).toEqual([])
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })

  test('keyword 比對姓名，也比對員工編號', async () => {
    const company = await registerCompany()
    const name = `陳${crypto.randomUUID().slice(0, 6)}`
    await call('/employees/main/create', company.token, profileBody({ name }))

    const byName = await call<EmployeeListShape>('/employees/main/list', company.token, {
      keyword: name,
      perPage: 20,
      currentPage: 1,
    })
    expect(byName.payload.data.pagination.totalCount).toBe(1)
  })

  test('員工編號重複回 409／300 與 employees.main.errors.code-duplicated，且不回聲既有員工', async () => {
    const company = await registerCompany()
    const employeeCode = uniqueCode('DUP')

    await call('/employees/main/create', company.token, profileBody({ employeeCode, name: '第一位' }))
    const second = await call('/employees/main/create', company.token, profileBody({ employeeCode, name: '第二位' }))

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors).toHaveLength(1)
    expect(second.payload.errors[0]?.code).toBe(EmployeeErrorCode.CodeDuplicated)
    expect(declaredCodes(EMPLOYEE_ENDPOINT_ERRORS.create)).toContain(EmployeeErrorCode.CodeDuplicated)
    // §3.2：不得回聲是哪一筆既有資料重複——否則建立表單就變成反查工具。
    expect(JSON.stringify(second.payload)).not.toContain('第一位')
  })

  test('身分證重複回 409／300，且錯誤內容不含身分證本身', async () => {
    const company = await registerCompany()
    const identityNumber = uniqueIdentityNumber()

    await call('/employees/main/create', company.token, profileBody({ identityNumber }))
    const second = await call('/employees/main/create', company.token, profileBody({ identityNumber }))

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(EmployeeErrorCode.IdentityNumberDuplicated)
    expect(declaredCodes(EMPLOYEE_ENDPOINT_ERRORS.create)).toContain(EmployeeErrorCode.IdentityNumberDuplicated)
    // §3.2 對敏感識別值的唯一性檢查：只回「無法建立」，且 §5.1 禁止把敏感值放進 errors[].data。
    expect(JSON.stringify(second.payload)).not.toContain(identityNumber)
  })

  test('大小寫不同的同一個身分證也算重複（blind index 前先正規化）', async () => {
    const company = await registerCompany()
    const identityNumber = uniqueIdentityNumber()

    await call('/employees/main/create', company.token, profileBody({ identityNumber }))
    const second = await call(
      '/employees/main/create',
      company.token,
      profileBody({ identityNumber: identityNumber.toLowerCase() }),
    )

    expect(second.status).toBe(409)
    expect(second.payload.errors[0]?.code).toBe(EmployeeErrorCode.IdentityNumberDuplicated)
  })

  test('修改員工：可以改員工編號，改到別人的編號則回 409', async () => {
    const company = await registerCompany()
    const first = await call<EmployeeDetailShape>('/employees/main/create', company.token, profileBody())
    const takenCode = first.payload.data.employeeCode

    const second = await call<EmployeeDetailShape>('/employees/main/create', company.token, profileBody())
    const renamed = uniqueCode('NEW')

    const okUpdate = await call<EmployeeDetailShape>('/employees/main/update', company.token, {
      id: second.payload.data.id,
      ...profileBody({ employeeCode: renamed, name: '改過名字' }),
    })
    expect(okUpdate.status).toBe(200)
    expect(okUpdate.payload.data.employeeCode).toBe(renamed)
    expect(okUpdate.payload.data.name).toBe('改過名字')

    const conflicting = await call('/employees/main/update', company.token, {
      id: second.payload.data.id,
      ...profileBody({ employeeCode: takenCode }),
    })
    expect(conflicting.status).toBe(409)
    expect(conflicting.payload.code).toBe('300')
    expect(conflicting.payload.errors[0]?.code).toBe(EmployeeErrorCode.CodeDuplicated)
  })

  test('刪除後同一個員工編號與身分證可以重新建立（deleted_seq 讓唯一鍵只約束有效資料）', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)
    const deleted = await call<{ id: string }>('/employees/main/delete', company.token, {
      id: created.payload.data.id,
    })
    expect(deleted.status).toBe(200)
    expect(deleted.payload.data.id).toBe(created.payload.data.id)

    // 刪掉的員工在 get 與 list 都等同不存在（§4.3）。
    const fetched = await call<EmployeeDetailShape | null>('/employees/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data).toBeNull()

    // 同樣的編號與身分證可以再建一次——沿用單欄唯一鍵的話，這個編號會被永久佔住。
    const recreated = await call<EmployeeDetailShape>('/employees/main/create', company.token, body)
    expect(recreated.status).toBe(200)
    expect(recreated.payload.data.employeeCode).toBe(body.employeeCode)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('重複刪除同一位員工，第二次回 employees.main.errors.state-changed', async () => {
    const company = await registerCompany()
    const created = await call<EmployeeDetailShape>('/employees/main/create', company.token, profileBody())

    const first = await call('/employees/main/delete', company.token, { id: created.payload.data.id })
    expect(first.status).toBe(200)

    // 第二次：目標已經被軟刪除，因此讀取階段就找不到 → not-found（不是 state-changed），
    // 兩者的使用者處置不同（§3.1.3）：一個是資料真的沒了，一個是重新載入清單就好。
    const second = await call('/employees/main/delete', company.token, { id: created.payload.data.id })
    expect(second.status).toBe(422)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(EmployeeErrorCode.NotFound)
    expect(declaredCodes(EMPLOYEE_ENDPOINT_ERRORS.delete)).toContain(EmployeeErrorCode.NotFound)
  })

  test('修改不存在的員工回 422／300 與 employees.main.errors.not-found', async () => {
    const company = await registerCompany()

    const updated = await call('/employees/main/update', company.token, {
      id: crypto.randomUUID(),
      ...profileBody(),
    })

    expect(updated.status).toBe(422)
    expect(updated.payload.code).toBe('300')
    expect(updated.payload.errors[0]?.code).toBe(EmployeeErrorCode.NotFound)
    expect(declaredCodes(EMPLOYEE_ENDPOINT_ERRORS.update)).toContain(EmployeeErrorCode.NotFound)
  })

  /**
   * §3.2 ＋ §7.1：跨公司存取**不是獨立斷言一組期望值**，而是斷言它與「目標不存在」那一條的回應
   * 逐項相同。寫成兩組各自硬編的期望值時，日後有人改了其中一條的訊息，兩邊就悄悄分岔而測試依然全綠
   * ——那正是這條規則要防的事。
   */
  test('查詢類：以 B 公司身分讀 A 公司的員工，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<EmployeeDetailShape>('/employees/main/create', companyA.token, profileBody())

    const crossCompany = await call('/employees/main/get', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/employees/main/get', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.payload.data).toBe(notFound.payload.data)
    // 查詢類的兩種情境都是 200 ＋ data: null（§3.1.3）。
    expect(crossCompany.status).toBe(200)
    expect(crossCompany.payload.data).toBeNull()
  })

  test('動作類：以 B 公司身分刪除 A 公司的員工，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<EmployeeDetailShape>('/employees/main/create', companyA.token, profileBody())

    const crossCompany = await call('/employees/main/delete', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/employees/main/delete', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.status).toBe(422)
    expect(crossCompany.payload.errors[0]?.code).toBe(EmployeeErrorCode.NotFound)

    // 而且 A 公司的員工真的沒有被刪掉。
    const stillThere = await call<EmployeeDetailShape | null>('/employees/main/get', companyA.token, {
      id: created.payload.data.id,
    })
    expect(stillThere.payload.data).not.toBeNull()
  })

  test('B 公司的清單看不到 A 公司的員工（§4.2）', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const body = profileBody()
    await call('/employees/main/create', companyA.token, body)

    const listed = await call<EmployeeListShape>('/employees/main/list', companyB.token, {
      keyword: body.employeeCode,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })

  test('未帶 token 一律回 401／900，且 expiresIn 為 null（§1.3）', async () => {
    const response = await app.handle(
      new Request('http://localhost/employees/main/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'employees.main.list',
          locale: 'zh-TW',
          perPage: 20,
          currentPage: 1,
        }),
      }),
    )
    const payload: unknown = await response.json()
    if (!asEnvelope(payload)) throw new Error('未登入的回應不是 envelope 形狀')

    expect(response.status).toBe(401)
    expect(payload.code).toBe('900')
    expect(payload.expiresIn).toBeNull()
  })

  /**
   * 格式不符的身分證在**進到 service 之前**就被 body schema 擋下（§1.8.0 的③）。
   *
   * 回的是 **400／`code='100'` 且 `errors` 為空**（§1.3）：schema 不符與 body 根本無法解析
   * 是同一類——契約已經定義好，送成這樣代表呼叫端沒照契約來，那是開發期就該發現的問題，
   * 不是要在執行期引導使用者的問題。出錯位置只進 log。
   *
   * 使用者層級的輸入問題（額度不足、狀態不允許）走的是另一條路：由 service 收集、以 `300`
   * 回來並帶 `errors`（§3.1.1）。兩條路徑的分界就是這條測試在守的東西。
   */
  test('格式不符的身分證被 body schema 擋下，不會進到 service', async () => {
    const company = await registerCompany()
    const invalid = await call('/employees/main/create', company.token, profileBody({ identityNumber: '123' }))

    expect(invalid.status).toBe(400)
    expect(invalid.payload.code).toBe('100')
    expect(invalid.payload.errors).toEqual([])

    // 而且沒有任何一位員工被建立起來。
    const listed = await call<EmployeeListShape>('/employees/main/list', company.token, {
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })
})
