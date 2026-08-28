/**
 * `/regulatory/sync/list` 的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**：要測的不只是查詢規則，還包括 envelope 的形狀、
 * HTTP status 與 envelope `code` 的映射、以及 `search`／`sort` 的回聲。斷言一律**同時檢查
 * HTTP status 與 `code`**（§7.1）。
 *
 * **歷程資料由 `runSync` 真的跑出來，不是手寫進資料表**（§7.3：凡是有對應正式流程者一律走該流程）。
 * 只有網路與計時器是替身，理由見 `regulatory-sync.run.test.ts` 檔頭。
 *
 * 測試資料隔離同 `regulatory-sync.run.test.ts`：全部掛在 `dataset_code = 1`，前後各清一次
 * （這三張表沒有 `company_id`，其他模組慣用的「每條測試自建一家公司」在這裡沒有對應物，§7.4）。
 *
 * ## §7.1 那五條裡，有兩條在這支端點上沒有對應物
 *
 * - **「跨公司存取」不適用**：法規三表是平台全域資料，沒有 `company_id`（計畫 §3.2 (b)），
 *   因此不存在「B 公司的 token 看到 A 公司的資料」這種情境——不是漏測，是沒有那個維度。
 * - **「業務規則不允許」不適用**：查詢類端點沒有業務錯誤（§3.1.3），本端點的錯誤碼宣告是空清單。
 *   「目標不存在」在這裡是「這個資料集還沒同步過」，回空清單而不是錯誤。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  regulatoryDatasetVersions,
  regulatoryRecords,
  RegulatorySyncStatus,
  regulatorySyncLogs,
  RegulatorySyncTriggerType,
} from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { runSync } from '../regulatory-sync.service.ts'
import { regulatorySyncRoutes } from '../regulatory-sync.routes.ts'

const database: Database = createDatabase({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 釘住「現在」（§6.2）。台北時間 2026-08-28 12:00:00。 */
const clock = fixedClock(new Date('2026-08-28T04:00:00.000Z'))

const LABOR_INSURANCE_SALARY = 1
const RESOURCE_URL = 'https://apiservice.test.invalid/OdService/download/TEST-020014-bbb'
const METADATA_URL = 'https://data.gov.tw/api/v2/rest/dataset/6258'

const metadataBody = JSON.stringify({
  result: {
    modifiedDate: '1961-01-02 09:58:56',
    distribution: [{ resourceFormat: 'JSON', resourceDownloadUrl: RESOURCE_URL }],
  },
})

/**
 * 民國 50 年（西元 1961）：真實法規不可能落在的年份，見 run 測試檔頭的保留鍵空間說明。
 *
 * **四種投保身分別都要在**：解析器要求身分別齊全，缺一種即整批失敗（政府整類刪除是法規變更，
 * 見 `domain/regulatory-labor-insurance-salary.ts` 的完整性檢查）。只寫一列的話這一份會解析失敗，
 * 於是下面那三筆歷程會全部變成 `status_code=3`，而本檔要驗的是三種狀態各一筆。
 */
const salaryPayload = JSON.stringify(
  [
    ['一般勞工', '29500元以下', '29500'],
    ['庇護性身心障礙者', '11100元以下', '11100'],
    ['部分工時勞工', '11100元以下', '11100'],
    ['職訓機構受訓者', '11100元以下', '11100'],
  ].map(([category, range, salary], index) => ({
    適用起日: '0500101',
    序號: String(index + 1),
    身分別: category,
    投保薪資等級: '1',
    月薪資總額: range,
    月投保薪資: salary,
  })),
)

/** 讓解析失敗的那一份（缺 `適用起日`）：用來產生一筆 `status_code=3` 的歷程。 */
const brokenPayload = JSON.stringify([
  { 序號: '1', 身分別: '一般勞工', 投保薪資等級: '1', 月薪資總額: '29500元以下', 月投保薪資: '29500' },
])

type ErrorItemShape = { readonly code: string; readonly msg: string }

type EnvelopeShape<TData> = {
  readonly code: string
  readonly msg: string
  readonly errors: readonly ErrorItemShape[]
  readonly data: TData
  readonly expiresIn: number | null
}

type SyncLogShape = {
  readonly id: number
  readonly datasetCode: number
  readonly triggerTypeCode: number
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly statusCode: number
  readonly datasetVersionId: number | null
  readonly governmentResourceId: string | null
  readonly recordsReceived: number | null
  readonly errorMessage: string | null
  readonly heartbeatAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

type SyncLogListShape = {
  readonly datasetName: string
  readonly datasets: readonly { readonly code: number; readonly name: string }[]
  readonly search: Record<string, unknown>
  readonly sort: { readonly field: string; readonly order: string }
  readonly pagination: { readonly currentPage: number; readonly perPage: number; readonly totalCount: number }
  readonly data: readonly SyncLogShape[]
}

const identityByToken = new Map<string, VerifiedIdentity>()
const permissionsByCompanyUser = new Map<string, ReadonlySet<string>>()

/**
 * 身分驗證的替身。
 *
 * §7.3 禁止 mock 掉**被測邏輯本身**，而 token 驗證與權限查詢屬於 `sessions`／`company-users`
 * 兩個模組。權限碼由路徑機械推導（§5.2.2），與 migration `0016` seed 進去的那一筆逐字相同。
 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: (_companyId, companyUserId) =>
    Promise.resolve(new Set(permissionsByCompanyUser.get(companyUserId) ?? [])),
}

const registerIdentity = (grantedCodes: readonly string[]): string => {
  const accessToken = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  identityByToken.set(accessToken, {
    sessionId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    companyId: crypto.randomUUID(),
    companyUserId,
  })
  permissionsByCompanyUser.set(companyUserId, new Set(grantedCodes))
  return accessToken
}

/** 與 `app/app.ts` 相同的中介層堆疊：測到的才是正式環境真正會跑的那一條路徑。 */
const app = new Elysia()
  .use(requestContext)
  .use(errorHandler(clock))
  .use(responseEnvelope(clock))
  .use(
    new Elysia({ name: 'test-authenticated-group' })
      .use(identityGuard(accessControl))
      .use(regulatorySyncRoutes({ db: database })),
  )

const token = registerIdentity(['regulatory.sync.list'])
const tokenWithoutPermission = registerIdentity([])

const asEnvelope = <TData>(payload: unknown): payload is EnvelopeShape<TData> => {
  if (typeof payload !== 'object' || payload === null) return false
  const record: Record<string, unknown> = { ...payload }
  return typeof record['code'] === 'string' && typeof record['msg'] === 'string' && Array.isArray(record['errors'])
}

const call = async <TData>(path: string, accessToken: string, body: Record<string, unknown>) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
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
    throw new Error(`${path} 的回應不是 envelope 形狀（HTTP ${String(response.status)}）：${JSON.stringify(payload)}`)
  }
  return { status: response.status, payload }
}

const purge = async (): Promise<void> => {
  const versions = await database
    .select({ id: regulatoryDatasetVersions.id })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, LABOR_INSURANCE_SALARY))
  const ids = versions.map((version) => version.id)

  await database.delete(regulatorySyncLogs).where(eq(regulatorySyncLogs.datasetCode, LABOR_INSURANCE_SALARY))
  if (ids.length > 0) {
    await database.delete(regulatoryRecords).where(inArray(regulatoryRecords.datasetVersionId, ids))
    await database.delete(regulatoryDatasetVersions).where(inArray(regulatoryDatasetVersions.id, ids))
  }
}

/** 跑一次同步以產生歷程。網路與計時器是替身，其餘全部是正式流程（§7.3）。 */
const seedSyncLog = async (payload: string) =>
  runSync(
    {
      db: database,
      clock,
      fetch: (url) =>
        Promise.resolve(
          url === METADATA_URL ? new Response(metadataBody, { status: 200 }) : new Response(payload, { status: 200 }),
        ),
      startHeartbeatTimer: () => () => undefined,
    },
    { datasetCode: LABOR_INSURANCE_SALARY, triggerTypeCode: RegulatorySyncTriggerType.Scheduled },
  )

beforeAll(async () => {
  await purge()
  // 三筆歷程：成功 → 無異動 → 失敗。三種狀態都要有，因為 `/list` 存在的理由就是
  // 「為什麼那三天沒同步」——而那個問題的答案全在 `status_code` 與 `error_message` 上。
  await seedSyncLog(salaryPayload)
  await seedSyncLog(salaryPayload)
  await seedSyncLog(brokenPayload)
})

afterAll(async () => {
  await purge()
})

describe('regulatory/sync/list (integration)', () => {
  test('回得出三筆歷程，含失敗原因；search／sort 有回聲', async () => {
    const listed = await call<SyncLogListShape>('/regulatory/sync/list', token, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 100,
      currentPage: 1,
    })

    expect(listed.status).toBe(200)
    expect(listed.payload.code).toBe('200')
    expect(listed.payload.errors).toEqual([])

    // 資料集名稱：唯一來源是 `REGULATORY_DATASETS`，不是前端另外維護的第三份對照
    // （這一輪的修復對象）。放在非列表部分——本端點一次只看一個資料集，每一列的名稱必然相同。
    expect(listed.payload.data.datasetName).toBe('勞工保險投保薪資分級表')

    // 「選擇資料集」的完整清單：固定九筆、固定順序（照代碼由小到大），供前端在查詢之前顯示選項，
    // 不必為了湊選項對九個代碼各打一次本端點。`7` 是永久空號，不得出現。
    expect(listed.payload.data.datasets.map((option) => option.code)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10])
    expect(listed.payload.data.datasets.some((option) => option.code === 7)).toBe(false)
    // 含人工維護（`10`，沒有解析器）與其他可能尚未同步過的資料集——不是只列「查得到紀錄的那些」。
    expect(listed.payload.data.datasets.find((option) => option.code === 10)?.name).toBe(
      '健保補充保險費（費率與計費門檻）',
    )
    expect(listed.payload.data.datasets.find((option) => option.code === LABOR_INSURANCE_SALARY)?.name).toBe(
      '勞工保險投保薪資分級表',
    )

    // §1.4：`search` 與 `sort` 必須回聲，否則前端的 race condition 防護當場失效。
    expect(listed.payload.data.search).toEqual({ datasetCode: LABOR_INSURANCE_SALARY })
    // 沒送 sort 時回聲的是**實際生效**的預設值（開始時間由新到舊），不是空物件。
    expect(listed.payload.data.sort).toEqual({ field: 'startedAt', order: 'desc' })
    expect(listed.payload.data.pagination.totalCount).toBe(3)

    const statuses = [...listed.payload.data.data].map((log) => log.statusCode).sort((a, b) => a - b)
    expect(statuses).toEqual(
      [RegulatorySyncStatus.Succeeded, RegulatorySyncStatus.Failed, RegulatorySyncStatus.NoChange].sort(
        (a, b) => a - b,
      ),
    )

    const failed = listed.payload.data.data.find((log) => log.statusCode === RegulatorySyncStatus.Failed)
    expect(failed).toBeDefined()
    // **失敗原因要看得到**：藏起來的話這張表只剩下「有沒有跑過」（計畫 §3.4）。
    expect(failed?.errorMessage).toContain('適用起日')
    expect(failed?.datasetVersionId).toBeNull()

    const succeeded = listed.payload.data.data.find((log) => log.statusCode === RegulatorySyncStatus.Succeeded)
    expect(succeeded?.errorMessage).toBeNull()
    // 4 = 四種投保身分別各一列（見 `salaryPayload`：身分別必須齊全，這是最小的一份合法資料）。
    expect(succeeded?.recordsReceived).toBe(4)
    expect(succeeded?.governmentResourceId).toBe(RESOURCE_URL)
    // 業務時間一律台北牆鐘、不帶時區標記（§6.1）。
    expect(succeeded?.startedAt).toBe('2026-08-28 12:00:00')
    expect(succeeded?.heartbeatAt).toBe('2026-08-28 12:00:00')
    expect(succeeded?.finishedAt).toBe('2026-08-28 12:00:00')
  })

  test('分頁與排序：第 1 頁與第 2 頁不得出現同一筆', async () => {
    // 三筆的 `started_at` 完全相同（clock 是固定的），因此這一條實際上在驗第二排序鍵 `id DESC`
    // ——少了它，同一列會同時出現在兩頁，而另一列一頁都沒出現。
    const firstPage = await call<SyncLogListShape>('/regulatory/sync/list', token, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 2,
      currentPage: 1,
    })
    const secondPage = await call<SyncLogListShape>('/regulatory/sync/list', token, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 2,
      currentPage: 2,
    })

    expect(firstPage.payload.data.data).toHaveLength(2)
    expect(secondPage.payload.data.data).toHaveLength(1)
    const firstIds = firstPage.payload.data.data.map((log) => log.id)
    const secondIds = secondPage.payload.data.data.map((log) => log.id)
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])

    // §1.4：`currentPage` 超出範圍回空陣列與正確的 pagination，不得回 404。
    const outOfRange = await call<SyncLogListShape>('/regulatory/sync/list', token, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 100,
      currentPage: 999,
    })
    expect(outOfRange.status).toBe(200)
    expect(outOfRange.payload.data.data).toEqual([])
    expect(outOfRange.payload.data.pagination.totalCount).toBe(3)
  })

  test('排序白名單以外的欄位被 schema 擋成 100（§1.4：欄位不進 SQL）', async () => {
    const bad = await call('/regulatory/sync/list', token, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 20,
      currentPage: 1,
      sort: { field: 'errorMessage', order: 'asc' },
    })

    expect(bad.status).toBe(400)
    expect(bad.payload.code).toBe('100')
  })

  test('尚未同步過的資料集回空清單，不是錯誤（§3.1.3）', async () => {
    // 這在目前是九個資料集裡八個的常態——當成錯誤的話，前端就得為它寫錯誤處理。
    const listed = await call<SyncLogListShape>('/regulatory/sync/list', token, {
      datasetCode: 9,
      perPage: 20,
      currentPage: 1,
    })

    expect(listed.status).toBe(200)
    expect(listed.payload.code).toBe('200')
    expect(listed.payload.data.data).toEqual([])
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })

  test('未知的 datasetCode 由 schema 擋成 100（`7` 是永久空號）', async () => {
    const reserved = await call('/regulatory/sync/list', token, { datasetCode: 7, perPage: 20, currentPage: 1 })

    expect(reserved.status).toBe(400)
    expect(reserved.payload.code).toBe('100')
  })
})

describe('認證（§1.3）', () => {
  test('未帶 token 回 401／900，且 expiresIn 為 null', async () => {
    const response = await app.handle(
      new Request('http://localhost/regulatory/sync/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'regulatory.sync.list',
          locale: 'zh-TW',
          datasetCode: LABOR_INSURANCE_SALARY,
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

  test('有身分但沒有 regulatory.sync.list：403／901，且 expiresIn 仍是續期後的正整數', async () => {
    // `901` 特別容易被寫成不續期，但那正是最不該的：使用者點到一個沒權限的功能，
    // 等於順便把自己的 session 熬短，下一次真正有權限的操作反而吃到 `900`（§1.3）。
    const denied = await call('/regulatory/sync/list', tokenWithoutPermission, {
      datasetCode: LABOR_INSURANCE_SALARY,
      perPage: 20,
      currentPage: 1,
    })

    expect(denied.status).toBe(403)
    expect(denied.payload.code).toBe('901')
    // §1.3：`901` 依規定不帶 errors——揭露被擋的理由本身就是資訊外洩（§3.2）。
    expect(denied.payload.errors).toEqual([])
    expect(denied.payload.data).toBeNull()
    expect(denied.payload.expiresIn).toBeGreaterThan(0)
  })
})
