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
 *
 * **沒有 `/employees/main/create` 的測試**（實作計畫 `05-employee-onboarding.md` §4.2 定案）：
 * 該端點已移除，新增員工唯一的路是 `/employees/onboarding/create`
 * （`modules/employees/onboarding/__tests__/`）——那裡才是「建立員工」這個 HTTP 動作真正的
 * 契約測試（envelope、`cmd`、遮罩、稽核全部涵蓋）。**本檔仍然需要建立員工作為 get／update／delete／
 * list 的前置資料**，做法是直接呼叫業務動作 `createEmployee`（`employees-main.service.ts` 仍然
 * export 它——§0.4 明文允許「沒有端點的業務動作」放入口檔）而不是繞過去直接寫資料庫（§7.3）：
 * 呼叫服務層函式本來就是「正式流程」，只是不再有 HTTP 端點包著它。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { companies, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { EmployeeErrorCode, EMPLOYEE_ENDPOINT_ERRORS, type EmployeeErrorDeclaration } from '../employees-main.errors.ts'
import { employeesMainRoutes } from '../employees-main.routes.ts'
import { createEmployee, type GenderValue } from '../employees-main.service.ts'

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

/**
 * `get`／`update` 共用的回應形狀。**含 `companyUserId`**（UI 定案
 * `docs/ui/20-employee-list.md` §3.5）：兩支端點共用同一個型別，理由見
 * `domain/employee-model.ts` 的 `EmployeeDetail` 檔頭——`apps/web` 把兩者的回應當成同一個
 * 「目前這位員工」狀態，只讓其中一支帶這一欄的話，另一支覆蓋回去時它就會消失。
 */
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
  readonly companyUserId: string | null
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
      new Set(['employees.main.list', 'employees.main.get', 'employees.main.update', 'employees.main.delete']),
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
        .use(employeesMainRoutes({ db, clock })),
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
const registerCompany = async (): Promise<{ companyId: string; companyUserId: string; token: string }> => {
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
  return { companyId, companyUserId, token }
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

/**
 * 建立一位員工作為前置資料（§7.3：直接呼叫業務動作，不是繞過去寫資料庫）。
 *
 * 回傳形狀刻意比照 `call<EmployeeDetailShape>(...)` 的 `{ status, payload: { data } }`，
 * 讓下面沿用既有斷言寫法的測試不必逐一改寫存取路徑。
 */
const createEmployeeFixture = async (
  company: { readonly companyId: string; readonly companyUserId: string },
  body: ReturnType<typeof profileBody>,
): Promise<{ readonly status: 200; readonly payload: { readonly data: EmployeeDetailShape } }> => {
  const result = await createEmployee(
    { db: database, clock, companyId: company.companyId, operatorCompanyUserId: company.companyUserId },
    {
      employeeCode: body['employeeCode'] as string,
      name: body['name'] as string,
      gender: body['gender'] as GenderValue,
      identityNumber: body['identityNumber'] as string,
      birthday: body['birthday'] as string,
      phone: body['phone'] as string,
      email: (body['email'] as string | undefined) ?? null,
      address: body['address'] as string,
    },
  )
  if (!result.ok) throw new Error(`測試 fixture 建立員工失敗：${JSON.stringify(result.errors)}`)
  return { status: 200, payload: { data: result.value } }
}

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('employees/main endpoints (integration)', () => {
  test('建立的員工敏感欄位一律遮罩，並能由 get 與 list 讀回', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await createEmployeeFixture(company, body)

    expect(created.payload.data.employeeCode).toBe(body.employeeCode)
    expect(created.payload.data.name).toBe('王小明')
    expect(created.payload.data.gender).toBe('MALE')

    // §5.1：對外回應一律遮罩，完整值不在任何端點提供。
    expect(created.payload.data.identityNumberMasked).toBe(`*******${body.identityNumber.slice(-3)}`)
    expect(created.payload.data.birthdayMasked).toBe('1990-**-**')
    expect(created.payload.data.phoneMasked).toBe('*******678')
    expect(created.payload.data.emailMasked).toBe('s***@example.com')
    expect(created.payload.data.addressMasked).toBe('台北市信義區***')

    const fetched = await call<EmployeeDetailShape | null>('/employees/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.status).toBe(200)
    expect(fetched.payload.data?.name).toBe('王小明')
    expect(fetched.payload.data?.identityNumberMasked).toBe(created.payload.data.identityNumberMasked)

    // 整包 get 回應裡找不到任何一段明文（handler 拿不到明文，見 `employees-main.handler.ts` 檔頭）。
    const serialized = JSON.stringify(fetched.payload)
    expect(serialized).not.toContain(body.identityNumber)
    expect(serialized).not.toContain('1990-05-21')
    expect(serialized).not.toContain('0912345678')
    expect(serialized).not.toContain('someone@example.com')
    expect(serialized).not.toContain('信義路五段')

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

  /**
   * UI 定案 `docs/ui/20-employee-list.md` §3.5：明細頁要管理這位員工的登入帳號與角色，
   * 前端得先由 `get` 拿到 `companyUserId` 才問得下去。
   *
   * 直接 `insert` 一筆屬於這位員工的 `company_users`：與 `registerCompany` 相同的既有慣例
   * （§7.3 的例外）——「員工既有時才補一個帳號」目前沒有正式流程，onboarding 走的是
   * 「新增員工當下同時建帳號」那條路，不是這裡要測的東西。
   */
  test('get 回應含 companyUserId：查無帳號時為 null，有效帳號存在時回其 id', async () => {
    const company = await registerCompany()
    const created = await createEmployeeFixture(company, profileBody())

    const withoutAccount = await call<EmployeeDetailShape | null>('/employees/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(withoutAccount.status).toBe(200)
    expect(withoutAccount.payload.data?.companyUserId).toBeNull()

    const employeeUserId = crypto.randomUUID()
    const employeeCompanyUserId = crypto.randomUUID()
    const now = clock.now()
    await database.insert(users).values({
      id: employeeUserId,
      username: `employee-${employeeUserId}`,
      passwordHash: 'not-a-real-hash',
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(companyUsers).values({
      id: employeeCompanyUserId,
      companyId: company.companyId,
      userId: employeeUserId,
      employeeId: created.payload.data.id,
      status: 'ACTIVE',
      activatedAt: now,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const withAccount = await call<EmployeeDetailShape | null>('/employees/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(withAccount.payload.data?.companyUserId).toBe(employeeCompanyUserId)
  })

  /**
   * 架構變更後的等效測試：過去這裡驗證「資料庫裡存的是密文」，現在的規則反過來——
   * 敏感個資改回明文儲存（改由資料庫端靜態加密負責，§5.1 現況），所以要驗證的是「新的明文欄位
   * 確實存了明文，且與建立時送出的值逐字相同」；`*_encrypted`／`*_hash` 舊欄位這一輪仍然保留
   * 但不再被寫入新值（見 `db/schema/employees.ts` 檔頭），因此新資料的舊欄位應為 `NULL`。
   */
  test('資料庫裡新的明文欄位存的就是明文，舊的加密欄位不再被新資料寫入', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await createEmployeeFixture(company, body)
    const [row] = await database
      .select({
        identityNumber: employees.identityNumber,
        birthday: employees.birthday,
        phone: employees.phone,
        email: employees.email,
        address: employees.address,
        identityNumberEncrypted: employees.identityNumberEncrypted,
        identityNumberHash: employees.identityNumberHash,
        birthdayEncrypted: employees.birthdayEncrypted,
        phoneEncrypted: employees.phoneEncrypted,
        addressEncrypted: employees.addressEncrypted,
      })
      .from(employees)
      .where(eq(employees.id, created.payload.data.id))

    if (row === undefined) throw new Error('剛建立的員工在資料庫裡找不到')

    // 新的明文欄位逐字等於建立時送出的值。
    expect(row.identityNumber).toBe(body.identityNumber)
    expect(row.birthday).toBe('1990-05-21')
    expect(row.phone).toBe('0912345678')
    expect(row.email).toBe('someone@example.com')
    expect(row.address).toBe(body.address)

    // 舊的加密欄位這一輪仍然保留，但新寫入的列不再產生密文——全部應為 NULL。
    expect(row.identityNumberEncrypted).toBeNull()
    expect(row.identityNumberHash).toBeNull()
    expect(row.birthdayEncrypted).toBeNull()
    expect(row.phoneEncrypted).toBeNull()
    expect(row.addressEncrypted).toBeNull()
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
    await createEmployeeFixture(company, profileBody({ name }))

    const byName = await call<EmployeeListShape>('/employees/main/list', company.token, {
      keyword: name,
      perPage: 20,
      currentPage: 1,
    })
    expect(byName.payload.data.pagination.totalCount).toBe(1)
  })

  test('員工編號重複回業務錯誤 employees.main.errors.code-duplicated，且不回聲既有員工', async () => {
    const company = await registerCompany()
    const employeeCode = uniqueCode('DUP')
    const context = {
      db: database,
      clock,
      companyId: company.companyId,
      operatorCompanyUserId: company.companyUserId,
    }

    await createEmployeeFixture(company, profileBody({ employeeCode, name: '第一位' }))
    const second = await createEmployee(context, {
      employeeCode,
      name: '第二位',
      gender: 'MALE',
      identityNumber: uniqueIdentityNumber(),
      birthday: '1990-05-21',
      phone: '0912345678',
      email: null,
      address: '台北市信義區信義路五段7號',
    })

    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('預期建立失敗')
    expect(second.errors).toHaveLength(1)
    expect(second.errors[0]?.code).toBe(EmployeeErrorCode.CodeDuplicated)
    // §3.2：不得回聲是哪一筆既有資料重複——否則建立表單就變成反查工具。
    expect(JSON.stringify(second.errors)).not.toContain('第一位')
  })

  test('身分證重複回業務錯誤，且錯誤內容不含身分證本身', async () => {
    const company = await registerCompany()
    const identityNumber = uniqueIdentityNumber()
    const context = {
      db: database,
      clock,
      companyId: company.companyId,
      operatorCompanyUserId: company.companyUserId,
    }

    await createEmployeeFixture(company, profileBody({ identityNumber }))
    const second = await createEmployee(context, {
      employeeCode: uniqueCode('EMP'),
      name: '王小明',
      gender: 'MALE',
      identityNumber,
      birthday: '1990-05-21',
      phone: '0912345678',
      email: null,
      address: '台北市信義區信義路五段7號',
    })

    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('預期建立失敗')
    expect(second.errors[0]?.code).toBe(EmployeeErrorCode.IdentityNumberDuplicated)
    // §3.2 對敏感識別值的唯一性檢查：只回「無法建立」，且 §5.1 禁止把敏感值放進 errors[].data。
    expect(JSON.stringify(second.errors)).not.toContain(identityNumber)
  })

  test('大小寫不同的同一個身分證也算重複（唯一鍵比對前先正規化）', async () => {
    const company = await registerCompany()
    const identityNumber = uniqueIdentityNumber()
    const context = {
      db: database,
      clock,
      companyId: company.companyId,
      operatorCompanyUserId: company.companyUserId,
    }

    await createEmployeeFixture(company, profileBody({ identityNumber }))
    const second = await createEmployee(context, {
      employeeCode: uniqueCode('EMP'),
      name: '王小明',
      gender: 'MALE',
      identityNumber: identityNumber.toLowerCase(),
      birthday: '1990-05-21',
      phone: '0912345678',
      email: null,
      address: '台北市信義區信義路五段7號',
    })

    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('預期建立失敗')
    expect(second.errors[0]?.code).toBe(EmployeeErrorCode.IdentityNumberDuplicated)
  })

  test('修改員工：可以改員工編號，改到別人的編號則回 409', async () => {
    const company = await registerCompany()
    const first = await createEmployeeFixture(company, profileBody())
    const takenCode = first.payload.data.employeeCode

    const second = await createEmployeeFixture(company, profileBody())
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

    const created = await createEmployeeFixture(company, body)
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
    const recreated = await createEmployeeFixture(company, body)
    expect(recreated.payload.data.employeeCode).toBe(body.employeeCode)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('重複刪除同一位員工，第二次回 employees.main.errors.not-found', async () => {
    const company = await registerCompany()
    const created = await createEmployeeFixture(company, profileBody())

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
    const created = await createEmployeeFixture(companyA, profileBody())

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
    const created = await createEmployeeFixture(companyA, profileBody())

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
    await createEmployeeFixture(companyA, body)

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
})
