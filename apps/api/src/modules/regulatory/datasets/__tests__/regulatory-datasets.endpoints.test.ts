/**
 * 法規資料集的端點測試（§7.1）。
 *
 * **從 HTTP 打進去，不直接呼叫 service**（唯一的例外見最後一個 describe，理由寫在那裡）：
 * 要測的不只是查詢規則，還包括 envelope 的形狀、HTTP status 與 envelope `code` 的映射、
 * 以及「查無適用版本」在 HTTP 這一側確實被收斂成 `data: null`——那些全部發生在 handler 與邊界層，
 * 繞過它們就等於沒測到。斷言一律**同時檢查 HTTP status 與 `code`**（§7.1）。
 *
 * ## 測試資料隔離：這三張表沒有 `company_id`，因此不能靠「新公司」隔離（§7.4）
 *
 * 法規三表是**平台全域**資料（計畫 §3.2 (b)），其他模組慣用的「每條測試自建一家公司」在這裡
 * 沒有對應物：本檔寫進去的版本，對同一個測試資料庫裡的每一次查詢都看得見。
 *
 * 因此改用**保留鍵空間**：本檔的測試版本一律落在 {@link RESERVED_WINDOW_FROM} 到
 * {@link RESERVED_WINDOW_TO} 這段民國前後的日期區間，而且**每一筆都寫明 `effective_to`**
 * ——於是它們不可能涵蓋任何一個現代日期，也就不可能影響 migration `0015` 那一版
 * （生效日 2021-01-01、`effective_to` 為 NULL）的解析結果。
 *
 * 進出各清一次（`beforeAll` ／ `afterAll`）：`beforeAll` 那一次是為了讓上一輪**中途崩潰**
 * 留下的殘骸不會讓這一輪的排序斷言飄掉。清的是本檔自己寫進去的那段區間，
 * 不是 truncate 全庫（§7.4 明文禁止後者，那會炸掉平行執行的其他測試）。
 *
 * 直接寫資料庫是 §7.3 的**明示例外**：這三張表目前**沒有任何正式流程**可以寫入
 * （`sync` 次目錄屬於 Stage 3，Stage 1 的匯入 script 也還沒建），本模組只有唯讀端點。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createDatabase, type Database } from '../../../../db/client.ts'
import { RegulatoryRawFormat, regulatoryDatasetVersions, regulatoryRecords } from '../../../../db/schema/index.ts'
import { errorHandler } from '../../../../http/error-handler.ts'
import { identityGuard } from '../../../../http/identity-guard.ts'
import { requestContext } from '../../../../http/request-context.ts'
import { responseEnvelope } from '../../../../http/response-envelope.ts'
import type { AccessControlPorts, VerifiedIdentity } from '../../../../shared/access-control.ts'
import { fixedClock } from '../../../../shared/clock.ts'
import { RegulatoryDatasetErrorCode } from '../regulatory-datasets.errors.ts'
import { regulatoryDatasetsRoutes } from '../regulatory-datasets.routes.ts'
import { resolveEffectiveDataset } from '../regulatory-datasets.service.ts'

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

/** `dataset_code = 10` 健保補充保險費：唯一有真實資料的資料集（migration `0015`）。 */
const SUPPLEMENTARY_PREMIUM = 10

/** 本檔專用的保留日期區間，見檔頭。真實法規資料不可能落在這裡。 */
const RESERVED_WINDOW_FROM = '1901-01-01'
const RESERVED_WINDOW_TO = '1949-12-31'

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

type VersionSummaryShape = {
  readonly id: number
  readonly datasetCode: number
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly recordCount: number | null
  readonly syncedAt: string
  readonly createdAt: string
}

type VersionDetailShape = VersionSummaryShape & {
  readonly governmentResourceId: string | null
  readonly sourceModifiedAt: string | null
  readonly checksum: string
  readonly rawFormatCode: number
}

type RecordShape = {
  readonly id: number
  readonly recordKey: string
  readonly rangeFrom: string | null
  readonly rangeTo: string | null
  readonly amount: string | null
  readonly rate: string | null
  readonly data: Record<string, unknown>
  readonly sortOrder: number | null
}

type ResolvedShape = {
  readonly datasetCode: number
  readonly asOfDate: string
  readonly version: VersionDetailShape
  readonly records: readonly RecordShape[]
}

type VersionListShape = {
  readonly search: Record<string, unknown>
  readonly sort: { readonly field: string; readonly order: string }
  readonly pagination: { readonly currentPage: number; readonly perPage: number; readonly totalCount: number }
  readonly data: readonly VersionSummaryShape[]
}

/** 每個 token 對應一個已驗證身分。 */
const identityByToken = new Map<string, VerifiedIdentity>()

/** 每個成員被授予哪些權限碼。空集合＝有身分但什麼都不准（§1.3 的 `901`）。 */
const permissionsByCompanyUser = new Map<string, ReadonlySet<string>>()

/**
 * 身分驗證的替身。
 *
 * §7.3 禁止 mock 掉**被測邏輯本身**，而 token 驗證與權限查詢屬於 `sessions`／`company-users`
 * 兩個模組——它們不是本檔要測的東西。三個權限碼由路徑機械推導（§5.2.2），
 * 與 migration `0014` seed 進去的那三筆逐字相同。
 *
 * `loadPermissionCodes` 依 `companyUserId` 分流而不是回一個固定集合：§7.1 要求每支端點都有一條
 * 「無權限角色被 403」的測試，而固定集合寫不出「這個人沒有這個碼」這種情境。
 */
const accessControl: AccessControlPorts = {
  verifyAccessToken: (token) => Promise.resolve(identityByToken.get(token) ?? null),
  renewSession: () => Promise.resolve({ expiresIn: 7200, exp: clock.transportNow() }),
  loadPermissionCodes: (_companyId, companyUserId) =>
    Promise.resolve(new Set(permissionsByCompanyUser.get(companyUserId) ?? [])),
}

/** 登記一個測試身分並指定它被授予哪些權限碼，回傳可用的 token。 */
const registerIdentity = (grantedCodes: readonly string[]): string => {
  const accessToken = crypto.randomUUID()
  const companyUserId = crypto.randomUUID()
  // 法規三表沒有 `company_id`，因此不需要真的建立一家公司——身分只用來通過憑證驗證器。
  identityByToken.set(accessToken, {
    sessionId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    companyId: crypto.randomUUID(),
    companyUserId,
  })
  permissionsByCompanyUser.set(companyUserId, new Set(grantedCodes))
  return accessToken
}

/**
 * 與 `app/app.ts` 相同的中介層堆疊。
 *
 * 逐字照抄組裝順序（error handler 包住全部、出口層在路由之前、認證群組包住端點），
 * 測到的才是正式環境真正會跑的那一條路徑。
 */
const buildTestApp = (db: Database) =>
  new Elysia()
    .use(requestContext)
    .use(errorHandler(clock))
    .use(responseEnvelope(clock))
    .use(
      new Elysia({ name: 'test-authenticated-group' })
        .use(identityGuard(accessControl))
        .use(regulatoryDatasetsRoutes({ db })),
    )

let database: Database
let app: ReturnType<typeof buildTestApp>
/** 具備本模組三個權限碼的身分。 */
let token: string
/** 有身分但一個權限碼都沒有的身分（§7.1 的「無權限角色被 403」）。 */
let tokenWithoutPermission: string

/**
 * 收窄 `response.json()`（型別是 `unknown`）到 envelope 形狀。
 *
 * **刻意是一個真的會檢查的守衛，而不是一次型別斷言**：這裡收的是 HTTP 邊界外的位元組，
 * 形狀本來就沒有任何靜態保證。
 */
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
    throw new Error(`${path} 的回應不是 envelope 形狀（HTTP ${response.status}）：${JSON.stringify(payload)}`)
  }
  return { status: response.status, payload }
}

/** 清掉保留區間內的全部測試資料。子表先刪（外鍵 `fk_regulatory_records_version` 是 NO ACTION）。 */
const purgeReservedVersions = async (): Promise<void> => {
  const rows = await database
    .select({ id: regulatoryDatasetVersions.id })
    .from(regulatoryDatasetVersions)
    .where(
      and(
        gte(regulatoryDatasetVersions.effectiveFrom, RESERVED_WINDOW_FROM),
        lte(regulatoryDatasetVersions.effectiveFrom, RESERVED_WINDOW_TO),
      ),
    )

  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return

  await database.delete(regulatoryRecords).where(inArray(regulatoryRecords.datasetVersionId, ids))
  await database.delete(regulatoryDatasetVersions).where(inArray(regulatoryDatasetVersions.id, ids))
}

/**
 * 寫入一個測試版本 ＋ 一筆 record，回傳版本 id。
 *
 * `effectiveTo` 是**必填參數而不是選填**：本檔的每一筆測試資料都必須有失效日，
 * 否則它會涵蓋所有現代日期並汙染其他測試（見檔頭的保留鍵空間說明）。
 *
 * 取回 id 用 `(dataset_code, version_code)` 這個唯一鍵反查，不用 `LAST_INSERT_ID` 之類的東西：
 * 唯一鍵在任何執行順序下都指向同一列。
 */
const insertTestVersion = async (input: {
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly effectiveTo: string
  readonly rate: string
}): Promise<number> => {
  const now = clock.now()

  await database.insert(regulatoryDatasetVersions).values({
    datasetCode: SUPPLEMENTARY_PREMIUM,
    versionCode: input.versionCode,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    governmentResourceId: null,
    sourceModifiedAt: null,
    syncedAt: now,
    checksum: `test-${input.versionCode}`,
    recordCount: 1,
    rawFormatCode: RegulatoryRawFormat.Text,
    rawData: `測試用版本 ${input.versionCode}`,
    createdAt: now,
  })

  const [row] = await database
    .select({ id: regulatoryDatasetVersions.id })
    .from(regulatoryDatasetVersions)
    .where(
      and(
        eq(regulatoryDatasetVersions.datasetCode, SUPPLEMENTARY_PREMIUM),
        eq(regulatoryDatasetVersions.versionCode, input.versionCode),
      ),
    )

  if (row === undefined) throw new Error(`剛寫入的測試版本 ${input.versionCode} 查不到`)

  await database.insert(regulatoryRecords).values({
    datasetVersionId: row.id,
    recordKey: 'rate',
    code: null,
    name: '測試費率',
    rangeFrom: null,
    rangeTo: null,
    amount: null,
    // 費率同時寫進 DECIMAL 欄位與 `data`，形狀與 migration `0015` 相同。
    rate: input.rate,
    data: { item: 'rate', rate: input.rate },
    sortOrder: 10,
    createdAt: now,
  })

  return row.id
}

/** 版本代碼帶隨機尾碼：`UNIQUE(dataset_code, version_code)` 讓固定值在第二次執行時直接寫不進去。 */
const uniqueVersionCode = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

beforeAll(async () => {
  database = createDatabase(readTestDatabaseConfig())
  app = buildTestApp(database)
  token = registerIdentity(['regulatory.datasets.list', 'regulatory.datasets.get', 'regulatory.datasets.resolve'])
  tokenWithoutPermission = registerIdentity([])
  await purgeReservedVersions()
})

afterAll(async () => {
  await purgeReservedVersions()
})

describe('regulatory/datasets/resolve (integration)', () => {
  test('dataset_code=10 回得出 2.11%／20,000／10,000,000，而且值一律是字串不是 number', async () => {
    const resolved = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '2026-01-01',
    })

    expect(resolved.status).toBe(200)
    expect(resolved.payload.code).toBe('200')
    expect(resolved.payload.errors).toEqual([])

    const data = resolved.payload.data
    if (data === null) throw new Error('dataset_code=10 在 2026-01-01 應該有適用版本')

    expect(data.datasetCode).toBe(SUPPLEMENTARY_PREMIUM)
    // 基準日原樣回聲：已結算 Payroll 要能證明這一版是用哪一天解析出來的。
    expect(data.asOfDate).toBe('2026-01-01')
    expect(data.version.versionCode).toBe('2021-01')
    expect(data.version.effectiveFrom).toBe('2021-01-01')
    // 政府沒有明示失效日，因此這一欄是 NULL——不是「下一版開始日的前一天」（計畫 §3.2 (d)）。
    expect(data.version.effectiveTo).toBeNull()

    const byKey = new Map(data.records.map((record) => [record.recordKey, record]))
    expect([...byKey.keys()]).toEqual(['rate', 'charge-lower-bound', 'single-payment-upper-limit'])

    // §4.7、計畫 §6.1：金額與費率一律是 decimal 字串。**斷言型別本身**，不只斷言值——
    // 只斷言值的話，`0.0211` 被轉成 JS number 之後這條測試照樣會過。
    const rate = byKey.get('rate')
    const lowerBound = byKey.get('charge-lower-bound')
    const upperLimit = byKey.get('single-payment-upper-limit')
    if (rate === undefined || lowerBound === undefined || upperLimit === undefined) {
      throw new Error('補充保險費的三筆 record 不齊全')
    }

    expect(typeof rate.data['rate']).toBe('string')
    expect(rate.data).toEqual({ item: 'rate', rate: '0.0211' })
    expect(lowerBound.data).toEqual({ item: 'chargeLowerBound', amount: '20000' })
    expect(upperLimit.data).toEqual({ item: 'singlePaymentUpperLimit', amount: '10000000' })

    // DECIMAL 欄位同樣是字串，而且保留資料庫的精度（DECIMAL(18,8) 與 DECIMAL(18,4)）。
    expect(rate.rate).toBe('0.02110000')
    expect(lowerBound.amount).toBe('20000.0000')
    expect(upperLimit.amount).toBe('10000000.0000')
    expect(typeof upperLimit.amount).toBe('string')

    // 回應裡沒有政府原始 Snapshot（計畫 §4.2：`/resolve` 與 `/get` 都不含 `raw_data`）。
    expect(JSON.stringify(resolved.payload)).not.toContain('全民健康保險法')
  })

  test('★ 兩筆 effective_from 相同時，resolve 的結果穩定：一律回後寫入的那一版（計畫 §3.2 (d)）', async () => {
    // 這一條是計畫明文要求的測試，而且必須打到真正的 SQL：`ORDER BY` 少了 `id DESC` 這個
    // 次要排序鍵時，挑到哪一筆由實體儲存順序與執行計畫決定——兩版的費率都是正常數字，
    // 沒有錯誤訊息，而且不可重現。純函式那一側的同一條測試在 `*-domain.test.ts`。
    const first = await insertTestVersion({
      versionCode: uniqueVersionCode('tie-a'),
      effectiveFrom: '1911-03-01',
      effectiveTo: '1911-12-31',
      rate: '0.0100',
    })
    const second = await insertTestVersion({
      versionCode: uniqueVersionCode('tie-b'),
      effectiveFrom: '1911-03-01',
      effectiveTo: '1911-12-31',
      rate: '0.0200',
    })
    expect(second).toBeGreaterThan(first)

    // 連續問三次都必須是同一個答案。
    for (const attempt of [1, 2, 3]) {
      const resolved = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
        datasetCode: SUPPLEMENTARY_PREMIUM,
        asOfDate: '1911-06-01',
      })
      const data = resolved.payload.data
      if (data === null) throw new Error(`第 ${attempt} 次查詢應該有適用版本`)
      expect(data.version.id).toBe(second)
      expect(data.records[0]?.data).toEqual({ item: 'rate', rate: '0.0200' })
    }
  })

  test('跨版邊界日：生效日當天換版，前一天仍是舊版', async () => {
    const older = await insertTestVersion({
      versionCode: uniqueVersionCode('boundary-old'),
      effectiveFrom: '1921-01-01',
      effectiveTo: '1921-12-31',
      rate: '0.0300',
    })
    const newer = await insertTestVersion({
      versionCode: uniqueVersionCode('boundary-new'),
      effectiveFrom: '1921-07-01',
      effectiveTo: '1921-12-31',
      rate: '0.0400',
    })

    const onEffectiveDay = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '1921-07-01',
    })
    expect(onEffectiveDay.payload.data?.version.id).toBe(newer)

    const dayBefore = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '1921-06-30',
    })
    expect(dayBefore.payload.data?.version.id).toBe(older)

    // 失效日當天仍適用，隔天就沒有版本了（`effective_to` 含當日）。
    const onLastDay = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '1921-12-31',
    })
    expect(onLastDay.payload.data?.version.id).toBe(newer)

    const dayAfter = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '1922-01-01',
    })
    expect(dayAfter.payload.data).toBeNull()
  })

  test('該基準日沒有適用版本：HTTP 200 ＋ code=200 ＋ data:null，不是業務錯誤（§3.1.3、計畫 §4.4）', async () => {
    // 補充保險費第一版生效日是 2021-01-01，前一天沒有任何版本涵蓋。
    const resolved = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      asOfDate: '2020-12-31',
    })

    expect(resolved.status).toBe(200)
    expect(resolved.payload.code).toBe('200')
    expect(resolved.payload.data).toBeNull()
    // 前端永遠不會在 `errors` 裡看到 `no-effective-version`（該端點宣告的清單是空的，§1.8.3）。
    expect(resolved.payload.errors).toEqual([])
  })

  test('尚未有任何版本的資料集，也是 data:null 而不是錯誤', async () => {
    const resolved = await call<ResolvedShape | null>('/regulatory/datasets/resolve', token, {
      datasetCode: 1,
      asOfDate: '2026-01-01',
    })

    expect(resolved.status).toBe(200)
    expect(resolved.payload.code).toBe('200')
    expect(resolved.payload.data).toBeNull()
  })

  test('asOfDate 是必填，沒帶就被 body schema 擋下（計畫 §4.2：不得預設今天）', async () => {
    // 這一條守的是整個模組最重要的一條規則：預設今天之後，補算去年 12 月的薪資會抓到
    // 今年的費率，算出一個**完全合理**的數字，沒有任何一層會發現不對。
    const missing = await call('/regulatory/datasets/resolve', token, { datasetCode: SUPPLEMENTARY_PREMIUM })

    expect(missing.status).toBe(400)
    expect(missing.payload.code).toBe('100')
    expect(missing.payload.errors).toEqual([])
  })

  test('未知的 datasetCode 由 schema 擋成 100，不是業務錯誤（計畫 §4.4）', async () => {
    // `7` 是永久空號（計畫 §3.1）：它在型別與執行期都不存在。
    const reserved = await call('/regulatory/datasets/resolve', token, { datasetCode: 7, asOfDate: '2026-01-01' })

    expect(reserved.status).toBe(400)
    expect(reserved.payload.code).toBe('100')
  })
})

describe('regulatory/datasets/get (integration)', () => {
  test('查得到時回完整 metadata，且不含 raw_data', async () => {
    const listed = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 100,
      currentPage: 1,
    })
    const seeded = listed.payload.data.data.find((version) => version.versionCode === '2021-01')
    if (seeded === undefined) throw new Error('migration 0015 的版本不在清單裡')

    const fetched = await call<VersionDetailShape | null>('/regulatory/datasets/get', token, { id: seeded.id })

    expect(fetched.status).toBe(200)
    expect(fetched.payload.code).toBe('200')
    expect(fetched.payload.data?.versionCode).toBe('2021-01')
    expect(fetched.payload.data?.effectiveFrom).toBe('2021-01-01')
    expect(fetched.payload.data?.recordCount).toBe(3)
    // 純文字（`RegulatoryRawFormat.Text`）：`raw_data` 是人工輸入時依據的來源說明，不是政府檔案。
    expect(fetched.payload.data?.rawFormatCode).toBe(5)
    expect(fetched.payload.data?.governmentResourceId).toBeNull()

    // 計畫 §4.2：`/get` 不含 `raw_data`。看原始 Snapshot 的端點刻意不開（計畫 D3）。
    const serialized = JSON.stringify(fetched.payload)
    expect(serialized).not.toContain('全民健康保險法')
    expect(serialized).not.toContain('rawData')
  })

  test('查不到回 HTTP 200 ＋ code=200 ＋ data:null，不是錯誤也不是 404（§3.1.3）', async () => {
    // 錯誤字典裡刻意沒有 `version-not-found`（計畫 §4.4）：多開一個 not-found 碼會讓這支端點的
    // 「查無資料」跟全站其他查詢端點長得不一樣，前端就得為它單獨寫一條分支。
    const fetched = await call<VersionDetailShape | null>('/regulatory/datasets/get', token, {
      id: Number.MAX_SAFE_INTEGER,
    })

    expect(fetched.status).toBe(200)
    expect(fetched.payload.code).toBe('200')
    expect(fetched.payload.data).toBeNull()
    expect(fetched.payload.errors).toEqual([])
  })
})

describe('regulatory/datasets/list (integration)', () => {
  test('分頁、排序與 search／sort 回聲', async () => {
    const codes = [uniqueVersionCode('list-1'), uniqueVersionCode('list-2'), uniqueVersionCode('list-3')]
    const ids = [
      await insertTestVersion({
        versionCode: codes[0] ?? '',
        effectiveFrom: '1931-01-01',
        effectiveTo: '1931-12-31',
        rate: '0.0100',
      }),
      await insertTestVersion({
        versionCode: codes[1] ?? '',
        effectiveFrom: '1932-01-01',
        effectiveTo: '1932-12-31',
        rate: '0.0200',
      }),
      await insertTestVersion({
        versionCode: codes[2] ?? '',
        effectiveFrom: '1933-01-01',
        effectiveTo: '1933-12-31',
        rate: '0.0300',
      }),
    ]

    const ascending = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 100,
      currentPage: 1,
      sort: { field: 'effectiveFrom', order: 'asc' },
    })

    expect(ascending.status).toBe(200)
    expect(ascending.payload.code).toBe('200')
    // §1.4：`search` 與 `sort` 必須原樣回聲，否則前端的 race condition 防護當場失效。
    expect(ascending.payload.data.search).toEqual({ datasetCode: SUPPLEMENTARY_PREMIUM })
    expect(ascending.payload.data.sort).toEqual({ field: 'effectiveFrom', order: 'asc' })
    // 清單不含 `raw_data`（本表禁止 `SELECT *`，計畫 §3.2 (c)）。
    expect(JSON.stringify(ascending.payload)).not.toContain('測試用版本')

    // 只看本測試寫進去的三筆，避免被同一個資料庫裡的其他版本影響。
    const ascendingIds = ascending.payload.data.data.map((version) => version.id).filter((id) => ids.includes(id))
    expect(ascendingIds).toEqual(ids)

    const descending = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 100,
      currentPage: 1,
      sort: { field: 'effectiveFrom', order: 'desc' },
    })
    const descendingIds = descending.payload.data.data.map((version) => version.id).filter((id) => ids.includes(id))
    expect(descendingIds).toEqual([...ids].reverse())

    // 沒送 sort 時回聲的是**實際生效**的預設值（生效日由新到舊），不是一個空物件。
    const defaulted = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 1,
      currentPage: 1,
    })
    expect(defaulted.payload.data.sort).toEqual({ field: 'effectiveFrom', order: 'desc' })
    expect(defaulted.payload.data.data).toHaveLength(1)
    expect(defaulted.payload.data.pagination.perPage).toBe(1)
    expect(defaulted.payload.data.pagination.totalCount).toBeGreaterThanOrEqual(4)

    // 第 1 頁與第 2 頁不得出現同一筆（第二排序鍵 `id DESC` 就是為了這件事）。
    const firstPage = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 2,
      currentPage: 1,
      sort: { field: 'effectiveFrom', order: 'asc' },
    })
    const secondPage = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 2,
      currentPage: 2,
      sort: { field: 'effectiveFrom', order: 'asc' },
    })
    const firstPageIds = firstPage.payload.data.data.map((version) => version.id)
    const secondPageIds = secondPage.payload.data.data.map((version) => version.id)
    expect(firstPageIds.filter((id) => secondPageIds.includes(id))).toEqual([])

    // §1.4：`currentPage` 超出範圍回空陣列與正確的 pagination，不得回 404。
    const outOfRange = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: SUPPLEMENTARY_PREMIUM,
      perPage: 100,
      currentPage: 999,
    })
    expect(outOfRange.status).toBe(200)
    expect(outOfRange.payload.data.data).toEqual([])
    expect(outOfRange.payload.data.pagination.currentPage).toBe(999)
    expect(outOfRange.payload.data.pagination.totalCount).toBeGreaterThanOrEqual(4)
  })

  test('沒有任何版本的資料集回空清單，不是錯誤（§3.1.3）', async () => {
    const listed = await call<VersionListShape>('/regulatory/datasets/list', token, {
      datasetCode: 9,
      perPage: 20,
      currentPage: 1,
    })

    expect(listed.status).toBe(200)
    expect(listed.payload.code).toBe('200')
    expect(listed.payload.data.data).toEqual([])
    expect(listed.payload.data.pagination.totalCount).toBe(0)
  })
})

describe('認證（§1.3）', () => {
  test('未帶 token 一律回 401／900，且 expiresIn 為 null', async () => {
    const response = await app.handle(
      new Request('http://localhost/regulatory/datasets/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rqTS: clock.transportNow(),
          cmd: 'regulatory.datasets.list',
          locale: 'zh-TW',
          datasetCode: SUPPLEMENTARY_PREMIUM,
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

  test('有身分但沒有權限碼：三支端點一律 403／901，且 expiresIn 仍是續期後的正整數', async () => {
    // §7.1 要求每支端點都有這一條。`901` 特別容易被寫成不續期（直覺上「被拒絕」看起來像失敗），
    // 但那正是最不該的：使用者點到一個沒權限的功能，等於順便把自己的 session 熬短，
    // 下一次真正有權限的操作反而吃到 `900`（§1.3）。
    const denied = [
      await call('/regulatory/datasets/list', tokenWithoutPermission, {
        datasetCode: SUPPLEMENTARY_PREMIUM,
        perPage: 20,
        currentPage: 1,
      }),
      await call('/regulatory/datasets/get', tokenWithoutPermission, { id: 1 }),
      await call('/regulatory/datasets/resolve', tokenWithoutPermission, {
        datasetCode: SUPPLEMENTARY_PREMIUM,
        asOfDate: '2026-01-01',
      }),
    ]

    for (const response of denied) {
      expect(response.status).toBe(403)
      expect(response.payload.code).toBe('901')
      // §1.3：`901` 依規定不帶 errors——前端對它的處置只有一種，而揭露被擋的理由本身就是資訊外洩。
      expect(response.payload.errors).toEqual([])
      expect(response.payload.data).toBeNull()
      expect(response.payload.expiresIn).toBeGreaterThan(0)
    }
  })
})

/**
 * service 那一側（Payroll 的呼叫路徑，計畫 §4.1）。
 *
 * **這一組刻意不打 HTTP**，因為它要驗的就是「同一件事在另一個呼叫者手上是另一種形狀」：
 * HTTP 那一側回 `data: null`，service 這一側回 `ServiceResult` 的失敗分支。
 * 只測 HTTP 的話，`no-effective-version` 這個碼在整個測試套件裡一次都不會被斷言到，
 * 而它正是 Payroll 唯一能據以停下來的東西——回 `null` 的話，300 人的批次結算裡
 * 那一個人的薪資單會安靜地消失。
 */
describe('resolveEffectiveDataset service（Payroll 的呼叫路徑）', () => {
  test('查無適用版本時回 ServiceResult 的失敗分支，帶 no-effective-version 而不是拋例外', async () => {
    const result = await resolveEffectiveDataset({ db: database }, { datasetCode: 10, asOfDate: '2020-12-31' })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors).toHaveLength(1)
    const [error] = result.errors
    expect(error?.code).toBe(RegulatoryDatasetErrorCode.NoEffectiveVersion)
    expect(error?.group).toBe('unprocessable')
    // 計畫 §4.4：`datasetCode` 與 `asOfDate` 必須在 `data` 裡，否則呼叫端轉譯成自己的錯誤碼時
    // 「哪個資料集、哪一天」這個唯一有用的資訊會掉光。
    expect(error?.data).toEqual({ field: 'asOfDate', datasetCode: 10, asOfDate: '2020-12-31' })
  })

  test('查得到時回成功分支，值是 decimal 字串', async () => {
    const result = await resolveEffectiveDataset({ db: database }, { datasetCode: 10, asOfDate: '2026-01-01' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.version.versionCode).toBe('2021-01')
    const rate = result.value.records.find((record) => record.recordKey === 'rate')
    // **這幾行同時是一則型別斷言**：`resolveEffectiveDataset` 以 `datasetCode` 為泛型參數，
    // 這裡寫死了 `10`，因此 `data` 的型別就是 `dataset_code=10` 那一個形狀，不是十個形狀的聯集
    // ——`'item' in data` 這種收窄不需要，`as` 更不需要。哪天泛型被改回去（或某一層把它收成
    // `RegulatoryDatasetCode`），下面這兩行會**編譯不過**，而不是靜靜地變回聯集。
    expect(rate?.data.item).toBe('rate')
    if (rate?.data.item === 'rate') {
      expect(rate.data.rate).toBe('0.0211')
    }
  })
})
