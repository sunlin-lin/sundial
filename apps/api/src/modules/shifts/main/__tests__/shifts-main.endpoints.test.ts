/**
 * 班別主檔的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是業務規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射。斷言一律**同時檢查 HTTP status 與 `code`**（§7.1）。
 *
 * 本檔沒有寫「無權限角色被 403」那一條（§7.1 的第三條）：權限碼的授予要靠
 * `company-users/roles` 與 `sessions` 模組，那兩個模組的落地方式與 `employees-main.endpoints.test.ts`
 * 相同的替身處置（見下方 `accessControl`）。
 *
 * 測試資料隔離（§7.4）：每一條測試都用自己隨機產生的公司 ID，彼此看不到對方的班別。
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
import { ShiftErrorCode, SHIFT_ENDPOINT_ERRORS, type ShiftErrorDeclaration } from '../shifts-main.errors.ts'
import { shiftsMainRoutes } from '../shifts-main.routes.ts'

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

type ShiftWorkPeriodShape = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly endDayOffset: number
  readonly workMinutes: number
}

type ShiftBreakShape = {
  readonly sequenceNo: number
  readonly startTime: string
  readonly endTime: string
  readonly startDayOffset: number
  readonly endDayOffset: number
  readonly breakMinutes: number
  readonly isPaid: boolean
}

type ShiftDetailShape = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly workTypeCode: number
  readonly isOvernight: boolean
  readonly isFlexible: boolean
  readonly requiredWorkMinutes: number
  readonly isActive: boolean
  readonly workPeriods: readonly ShiftWorkPeriodShape[]
  readonly breaks: readonly ShiftBreakShape[]
  readonly description: string
}

type ShiftListShape = {
  readonly search: Record<string, unknown>
  readonly sort: { readonly field: string; readonly order: string }
  readonly pagination: { readonly currentPage: number; readonly perPage: number; readonly totalCount: number }
  readonly data: readonly ShiftDetailShape[]
}

const identityByToken = new Map<string, VerifiedIdentity>()

/** 身分驗證的替身（§7.3）：token 驗證與權限查詢屬於尚未落地的 `sessions`／`company-users` 模組。 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: () =>
    Promise.resolve(
      new Set([
        'shifts.main.list',
        'shifts.main.get',
        'shifts.main.create',
        'shifts.main.update',
        'shifts.main.copy',
        'shifts.main.delete',
      ]),
    ),
}

/** 與 `app/app.ts` 相同的中介層堆疊，理由見 `employees-main.endpoints.test.ts` 同名函式。 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(shiftsMainRoutes({ db, clock })),
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

const declaredCodes = (declarations: readonly ShiftErrorDeclaration[]): readonly string[] =>
  declarations.map((declaration) => declaration.code)

const uniqueCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

/** 一般班：09:00–18:00，不跨日、無休息。 */
const profileBody = (overrides: Record<string, unknown> = {}) => ({
  code: uniqueCode('SFT'),
  name: '一般日班',
  workTypeCode: 1,
  isFlexible: false,
  description: '測試用班別說明',
  isActive: true,
  workPeriods: [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
  breaks: [],
  ...overrides,
})

/** ★ 驗收案例（計畫 Stage 2）：22:00–06:00 含 02:00–03:00 無薪休息的跨日班。 */
const overnightBody = (overrides: Record<string, unknown> = {}) =>
  profileBody({
    name: '夜班',
    workPeriods: [{ sequenceNo: 1, startTime: '22:00', endTime: '06:00', endDayOffset: 1 }],
    breaks: [
      { sequenceNo: 1, startTime: '02:00', endTime: '03:00', startDayOffset: 1, endDayOffset: 1, isPaid: false },
    ],
    ...overrides,
  })

beforeAll(() => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
})

describe('shifts/main endpoints (integration)', () => {
  test('★ 22:00–06:00 含 02:00–03:00 無薪休息的跨日班：isOvernight=true，requiredWorkMinutes=420', async () => {
    const company = await registerCompany()

    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, overnightBody())

    expect(created.status).toBe(200)
    expect(created.payload.code).toBe('200')
    expect(created.payload.data.isOvernight).toBe(true)
    expect(created.payload.data.requiredWorkMinutes).toBe(420)
    expect(created.payload.data.workPeriods[0]?.workMinutes).toBe(480)
    expect(created.payload.data.breaks[0]?.breakMinutes).toBe(60)

    // get 讀回來的推導值必須與建立當下算出來的一致（存下來的，不是每次現算，計畫 §4.1）。
    const fetched = await call<ShiftDetailShape | null>('/shifts/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data?.isOvernight).toBe(true)
    expect(fetched.payload.data?.requiredWorkMinutes).toBe(420)
  })

  test('建立一般班成功，可由 get 與 list 讀回，isOvernight=false', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, body)
    expect(created.status).toBe(200)
    expect(created.payload.data.code).toBe(body.code)
    expect(created.payload.data.isOvernight).toBe(false)
    expect(created.payload.data.requiredWorkMinutes).toBe(540)
    expect(created.payload.cmd).toBe('shifts.main.create')
    expect(created.payload.expiresIn).toBe(7200)

    const listed = await call<ShiftListShape>('/shifts/main/list', company.token, {
      keyword: body.code,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.payload.data.pagination.totalCount).toBe(1)
    expect(listed.payload.data.data[0]?.id).toBe(created.payload.data.id)
    expect(listed.payload.data.data[0]?.workPeriods).toEqual(created.payload.data.workPeriods)
  })

  test('中空班的空檔合法：兩段工作時段中間有空檔可以通過', async () => {
    const company = await registerCompany()
    const body = profileBody({
      workPeriods: [
        { sequenceNo: 1, startTime: '08:00', endTime: '12:00', endDayOffset: 0 },
        { sequenceNo: 2, startTime: '14:00', endTime: '18:00', endDayOffset: 0 },
      ],
    })

    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, body)
    expect(created.status).toBe(200)
    expect(created.payload.data.requiredWorkMinutes).toBe(480)
  })

  test('工作時段重疊被擋，回 422／300', async () => {
    const company = await registerCompany()
    const body = profileBody({
      workPeriods: [
        { sequenceNo: 1, startTime: '09:00', endTime: '13:00', endDayOffset: 0 },
        { sequenceNo: 2, startTime: '12:00', endTime: '18:00', endDayOffset: 0 },
      ],
    })

    const result = await call('/shifts/main/create', company.token, body)
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.WorkPeriodsOverlap)
    expect(declaredCodes(SHIFT_ENDPOINT_ERRORS.create)).toContain(ShiftErrorCode.WorkPeriodsOverlap)
  })

  /**
   * 協調者指定的情境：兩段休息 12:00–13:00 與 12:30–13:30，**都**完整落在工作時段內
   * （不會被 `BreakOutsideWorkPeriod` 擋到），問題只在兩段彼此重疊——重疊的那半小時會在
   * `requiredWorkMinutes` 的計算裡被扣兩次，那個值是出勤判定的分母。
   */
  test('休息時段彼此重疊被擋，回 422／300 與 shifts.main.errors.breaks-overlap', async () => {
    const company = await registerCompany()
    const body = profileBody({
      workPeriods: [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      breaks: [
        { sequenceNo: 1, startTime: '12:00', endTime: '13:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
        { sequenceNo: 2, startTime: '12:30', endTime: '13:30', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    })

    const result = await call('/shifts/main/create', company.token, body)
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.BreaksOverlap)
    expect(declaredCodes(SHIFT_ENDPOINT_ERRORS.create)).toContain(ShiftErrorCode.BreaksOverlap)
  })

  test('應工作分鐘算出來不是正值被擋（最後一道防線），回 422／300 與 shifts.main.errors.required-work-minutes-not-positive', async () => {
    const company = await registerCompany()
    // 無薪休息剛好等於整段工作時段：結構本身合法（休息完整落在工作時段內、彼此不重疊），
    // 但 requiredWorkMinutes 算出來是 0——不合理的班別，必須擋在建立當下。
    const body = profileBody({
      workPeriods: [{ sequenceNo: 1, startTime: '09:00', endTime: '10:00', endDayOffset: 0 }],
      breaks: [
        { sequenceNo: 1, startTime: '09:00', endTime: '10:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    })

    const result = await call('/shifts/main/create', company.token, body)
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.RequiredWorkMinutesNotPositive)
    expect(result.payload.errors[0]?.data?.['requiredWorkMinutes']).toBe(0)
    expect(declaredCodes(SHIFT_ENDPOINT_ERRORS.create)).toContain(ShiftErrorCode.RequiredWorkMinutesNotPositive)
  })

  test('休息落在工作時段外被擋，回 422／300', async () => {
    const company = await registerCompany()
    const body = profileBody({
      workPeriods: [{ sequenceNo: 1, startTime: '09:00', endTime: '18:00', endDayOffset: 0 }],
      breaks: [
        { sequenceNo: 1, startTime: '19:00', endTime: '20:00', startDayOffset: 0, endDayOffset: 0, isPaid: false },
      ],
    })

    const result = await call('/shifts/main/create', company.token, body)
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.BreakOutsideWorkPeriod)
  })

  test('零工作時段被擋，回 422／300', async () => {
    const company = await registerCompany()
    const body = profileBody({ workPeriods: [] })

    const result = await call('/shifts/main/create', company.token, body)
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.WorkPeriodsEmpty)
  })

  test('description 為空字串被擋在 body schema（400／100），不會進到 service', async () => {
    const company = await registerCompany()
    const result = await call('/shifts/main/create', company.token, profileBody({ description: '' }))

    expect(result.status).toBe(400)
    expect(result.payload.code).toBe('100')
    expect(result.payload.errors).toEqual([])
  })

  test('同公司 code 重複回 409／300 與 shifts.main.errors.code-duplicated（不是 500）', async () => {
    const company = await registerCompany()
    const code = uniqueCode('DUP')

    await call('/shifts/main/create', company.token, profileBody({ code, name: '第一班' }))
    const second = await call('/shifts/main/create', company.token, profileBody({ code, name: '第二班' }))

    expect(second.status).toBe(409)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(ShiftErrorCode.CodeDuplicated)
    expect(declaredCodes(SHIFT_ENDPOINT_ERRORS.create)).toContain(ShiftErrorCode.CodeDuplicated)
  })

  test('軟刪除後同一個 code 可以再建立', async () => {
    const company = await registerCompany()
    const body = profileBody()

    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, body)
    const deleted = await call<{ id: string }>('/shifts/main/delete', company.token, { id: created.payload.data.id })
    expect(deleted.status).toBe(200)

    const fetched = await call<ShiftDetailShape | null>('/shifts/main/get', company.token, {
      id: created.payload.data.id,
    })
    expect(fetched.payload.data).toBeNull()

    const recreated = await call<ShiftDetailShape>('/shifts/main/create', company.token, body)
    expect(recreated.status).toBe(200)
    expect(recreated.payload.data.code).toBe(body.code)
    expect(recreated.payload.data.id).not.toBe(created.payload.data.id)
  })

  test('重複刪除同一個班別，第二次回 shifts.main.errors.not-found（已刪除即等同不存在）', async () => {
    const company = await registerCompany()
    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, profileBody())

    const first = await call('/shifts/main/delete', company.token, { id: created.payload.data.id })
    expect(first.status).toBe(200)

    const second = await call('/shifts/main/delete', company.token, { id: created.payload.data.id })
    expect(second.status).toBe(422)
    expect(second.payload.code).toBe('300')
    expect(second.payload.errors[0]?.code).toBe(ShiftErrorCode.NotFound)
  })

  test('修改班別：全量替換時段與休息，並可修改 code／isActive', async () => {
    const company = await registerCompany()
    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, profileBody())

    const renamed = uniqueCode('NEW')
    const updated = await call<ShiftDetailShape>('/shifts/main/update', company.token, {
      id: created.payload.data.id,
      ...profileBody({
        code: renamed,
        name: '改過的班別',
        isActive: false,
        workPeriods: [{ sequenceNo: 1, startTime: '08:00', endTime: '17:00', endDayOffset: 0 }],
      }),
    })

    expect(updated.status).toBe(200)
    expect(updated.payload.data.code).toBe(renamed)
    expect(updated.payload.data.isActive).toBe(false)
    expect(updated.payload.data.workPeriods).toHaveLength(1)
    expect(updated.payload.data.workPeriods[0]?.startTime).toBe('08:00')
    expect(updated.payload.data.requiredWorkMinutes).toBe(540)
  })

  test('本輪班別可以自由修改，即使並非新建立的那一筆（計畫 §7：本輪不實作引用防護）', async () => {
    const company = await registerCompany()
    const created = await call<ShiftDetailShape>('/shifts/main/create', company.token, profileBody())

    // 沒有任何「這個班別已被使用」的檢查會擋下這次修改——這是本輪刻意的定案，不是漏測。
    const updated = await call<ShiftDetailShape>('/shifts/main/update', company.token, {
      id: created.payload.data.id,
      ...profileBody({ code: created.payload.data.code, name: '再次修改' }),
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.data.name).toBe('再次修改')
  })

  test('修改不存在的班別回 422／300 與 shifts.main.errors.not-found', async () => {
    const company = await registerCompany()

    const result = await call('/shifts/main/update', company.token, {
      id: crypto.randomUUID(),
      ...profileBody(),
    })
    expect(result.status).toBe(422)
    expect(result.payload.code).toBe('300')
    expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.NotFound)
    expect(declaredCodes(SHIFT_ENDPOINT_ERRORS.update)).toContain(ShiftErrorCode.NotFound)
  })

  test('copy 複製出完整的時段與休息，且不動到來源', async () => {
    const company = await registerCompany()
    const source = await call<ShiftDetailShape>('/shifts/main/create', company.token, overnightBody())

    const copyCode = uniqueCode('COPY')
    const copied = await call<ShiftDetailShape>('/shifts/main/copy', company.token, {
      sourceId: source.payload.data.id,
      code: copyCode,
      name: '夜班（複製）',
      description: '從夜班複製，微調休息時間前先建一份',
      isActive: true,
    })

    expect(copied.status).toBe(200)
    expect(copied.payload.data.id).not.toBe(source.payload.data.id)
    expect(copied.payload.data.code).toBe(copyCode)
    // 內容整組取自來源（計畫 §7）：工時管理方式、彈性旗標、跨日、應工作分鐘、時段與休息都一致。
    expect(copied.payload.data.workTypeCode).toBe(source.payload.data.workTypeCode)
    expect(copied.payload.data.isFlexible).toBe(source.payload.data.isFlexible)
    expect(copied.payload.data.isOvernight).toBe(source.payload.data.isOvernight)
    expect(copied.payload.data.requiredWorkMinutes).toBe(source.payload.data.requiredWorkMinutes)
    expect(copied.payload.data.workPeriods).toEqual(source.payload.data.workPeriods)
    expect(copied.payload.data.breaks).toEqual(source.payload.data.breaks)

    // 來源沒有被動到：仍然啟用、仍然是原本的代碼與內容。
    const sourceAfter = await call<ShiftDetailShape | null>('/shifts/main/get', company.token, {
      id: source.payload.data.id,
    })
    expect(sourceAfter.payload.data?.isActive).toBe(true)
    expect(sourceAfter.payload.data?.code).toBe(source.payload.data.code)
    expect(sourceAfter.payload.data?.workPeriods).toEqual(source.payload.data.workPeriods)
  })

  test('copy 的來源不存在（含跨公司）回 422／300 與 shifts.main.errors.not-found，field 指到 sourceId', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const source = await call<ShiftDetailShape>('/shifts/main/create', companyA.token, profileBody())

    const notFound = await call('/shifts/main/copy', companyA.token, {
      sourceId: crypto.randomUUID(),
      code: uniqueCode('COPY'),
      name: '複製',
      description: '說明',
      isActive: true,
    })
    const crossCompany = await call('/shifts/main/copy', companyB.token, {
      sourceId: source.payload.data.id,
      code: uniqueCode('COPY'),
      name: '複製',
      description: '說明',
      isActive: true,
    })

    for (const result of [notFound, crossCompany]) {
      expect(result.status).toBe(422)
      expect(result.payload.code).toBe('300')
      expect(result.payload.errors[0]?.code).toBe(ShiftErrorCode.NotFound)
      expect(result.payload.errors[0]?.data?.['field']).toBe('sourceId')
    }
  })

  test('列表預設只回啟用班別，停用的班別要明確帶 isActive:false 才看得到', async () => {
    const company = await registerCompany()
    const active = await call<ShiftDetailShape>('/shifts/main/create', company.token, profileBody())
    const toDeactivate = await call<ShiftDetailShape>('/shifts/main/create', company.token, profileBody())
    await call('/shifts/main/update', company.token, {
      id: toDeactivate.payload.data.id,
      ...profileBody({ code: toDeactivate.payload.data.code, isActive: false }),
    })

    const defaultList = await call<ShiftListShape>('/shifts/main/list', company.token, { perPage: 20, currentPage: 1 })
    const defaultIds = defaultList.payload.data.data.map((item) => item.id)
    expect(defaultIds).toContain(active.payload.data.id)
    expect(defaultIds).not.toContain(toDeactivate.payload.data.id)
    // 回聲的 search 沒有 isActive：使用者沒有明確送這個條件（§1.4），預設值是 handler 補的，
    // 不是使用者送的。
    expect(defaultList.payload.data.search).not.toHaveProperty('isActive')

    const inactiveList = await call<ShiftListShape>('/shifts/main/list', company.token, {
      isActive: false,
      perPage: 20,
      currentPage: 1,
    })
    const inactiveIds = inactiveList.payload.data.data.map((item) => item.id)
    expect(inactiveIds).toContain(toDeactivate.payload.data.id)
    expect(inactiveIds).not.toContain(active.payload.data.id)
  })

  test('查詢類：以 B 公司身分讀 A 公司的班別，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<ShiftDetailShape>('/shifts/main/create', companyA.token, profileBody())

    const crossCompany = await call('/shifts/main/get', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/shifts/main/get', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.payload.data).toBe(notFound.payload.data)
    expect(crossCompany.status).toBe(200)
    expect(crossCompany.payload.data).toBeNull()
  })

  test('動作類：以 B 公司身分刪除 A 公司的班別，回應與「不存在」逐項相同', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const created = await call<ShiftDetailShape>('/shifts/main/create', companyA.token, profileBody())

    const crossCompany = await call('/shifts/main/delete', companyB.token, { id: created.payload.data.id })
    const notFound = await call('/shifts/main/delete', companyB.token, { id: crypto.randomUUID() })

    expect(crossCompany.status).toBe(notFound.status)
    expect(crossCompany.payload.code).toBe(notFound.payload.code)
    expect(crossCompany.payload.msg).toBe(notFound.payload.msg)
    expect(crossCompany.payload.errors).toEqual(notFound.payload.errors)
    expect(crossCompany.status).toBe(422)

    const stillThere = await call<ShiftDetailShape | null>('/shifts/main/get', companyA.token, {
      id: created.payload.data.id,
    })
    expect(stillThere.payload.data).not.toBeNull()
  })

  test('B 公司的清單看不到 A 公司的班別（§4.2）', async () => {
    const companyA = await registerCompany()
    const companyB = await registerCompany()
    const body = profileBody()
    await call('/shifts/main/create', companyA.token, body)

    const listed = await call<ShiftListShape>('/shifts/main/list', companyB.token, {
      keyword: body.code,
      perPage: 20,
      currentPage: 1,
    })
    expect(listed.status).toBe(200)
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })

  test('未帶 token 一律回 401／900，且 expiresIn 為 null（§1.3）', async () => {
    const response = await app.handle(
      new Request('http://localhost/shifts/main/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'shifts.main.list',
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
