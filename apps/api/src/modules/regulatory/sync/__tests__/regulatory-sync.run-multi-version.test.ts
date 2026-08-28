/**
 * 多版本同步的整合測試：**一次同步 → N 個版本**（`dataset_code=2`、`5`），真的寫進測試資料庫。
 *
 * ## 為什麼是獨立一個檔案
 *
 * `regulatory-sync.run.test.ts` 驗的是單資源那條路（下載 → 比 checksum → 一個版本），
 * 而這一批驗的四件事在那條路上**根本不存在**：幂等（跑第二次不重複建版本）、
 * 一個版本失敗其餘仍然寫入、每個版本各自一個交易、全部已存在時的結果。
 * 兩批混在同一個檔案裡，`beforeEach` 要同時照顧兩個資料集的殘骸，而那正是最容易寫錯的地方。
 *
 * ## 被替換掉的只有網路與計時器（§7.3）
 *
 * 與那一支相同：`fetch` 與心跳計時器是注入的函式型別，不是被攔截的模組。
 * 生效日推導、CSV 解析、計畫排定、形狀驗證、交易寫入全部跑真的那一份。
 *
 * ## 測試資料隔離：三張表沒有 `company_id`（§7.4）
 *
 * 法規三表是平台全域資料，其他模組慣用的「每條測試自建一家公司」在這裡沒有對應物。
 * 本檔用**保留鍵空間**：全部資料掛在 `dataset_code = 2`，生效日一律民國 40 年代
 * （西元 1951–1953）——真實的健保投保金額分級表最早只到民國 100 年，因此即使某一輪崩潰留下殘骸，
 * 也不會與任何真實版本撞 `version_code`。每條測試前後各清一次。
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { createDatabase, type Database } from '../../../../db/client.ts'
import {
  regulatoryDatasetVersions,
  regulatoryRecords,
  RegulatorySyncStatus,
  regulatorySyncLogs,
  RegulatorySyncTriggerType,
} from '../../../../db/schema/index.ts'
import { clockFrom } from '../../../../shared/clock.ts'
import { resolveEffectiveDataset } from '../../datasets/regulatory-datasets.service.ts'
import type { HeartbeatTick, RegulatorySyncContext, StopHeartbeatTimer } from '../regulatory-sync.service.ts'
import { runSync } from '../regulatory-sync.service.ts'

/** 連的是不是測試資料庫由 `test-setup.ts` 的 preload 守衛（§7.4），理由同單資源那一支。 */
const database: Database = createDatabase({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 全民健康保險投保金額分級表：16 個資源、每一個是一個年度版本。 */
const HEALTH_INSURANCE_GRADES = 2

const METADATA_URL = 'https://data.gov.tw/api/v2/rest/dataset/20251'
const resourceUrl = (id: string): string => `https://info.nhi.test.invalid/api/iode0000s01/Dataset?rId=${id}`

/**
 * 三個資源，生效日民國 40／41／42 年 1 月。
 *
 * **metadata 裡的順序刻意是亂的**（41、40、42）：計畫會依生效日重排，而「回補時 id 的順序與生效日
 * 一致」正是那個排序存在的理由（計畫 §3.2 (d) 的 `id DESC` 次要排序鍵在同日生效時才有可預期的語意）。
 */
const RESOURCES = [
  { id: 'roc41', description: '41年1月全民健康保險投保金額分級表', effectiveFrom: '1952-01-01', versionCode: '1952-01' },
  { id: 'roc40', description: '40年1月全民健康保險投保金額分級表', effectiveFrom: '1951-01-01', versionCode: '1951-01' },
  { id: 'roc42', description: '42年1月全民健康保險投保金額分級表', effectiveFrom: '1953-01-01', versionCode: '1953-01' },
] as const

const HEADER = '組別級距,投保等級,月投保金額（元）,實際薪資月額（元）'

/**
 * 一份合法的分級表 CSV（三級）。`base` 讓每一個版本的金額不同，於是 checksum 也不同
 * ——三個版本內容完全一樣的話，「幂等靠的是 version_code 不是 checksum」這件事就驗不到。
 */
const gradeCsv = (base: number): string =>
  `﻿${[
    HEADER,
    `第一組級距1200元,1,${String(base)},${String(base)}以下`,
    `第二組級距1500元,2,${String(base + 800)},${String(base + 1)}-${String(base + 800)}`,
    `第二組級距1500元,3,${String(base + 2300)},${String(base + 801)}以上`,
  ].join('\r\n')}\r\n`

/** 每一份 CSV 的筆數。散在好幾條斷言裡，寫成常數才不會改了一處漏三處。 */
const RECORDS_PER_VERSION = 3

/** 政府那一份壞掉的樣子：級距之間有缺口，落在缺口裡的薪資查不到任何一級。 */
const BROKEN_CSV = `﻿${[
  HEADER,
  '第一組級距1200元,1,29500,29500以下',
  '第二組級距1500元,2,30300,29800-30300',
  '第二組級距1500元,3,31800,30301以上',
].join('\r\n')}\r\n`

const metadataBody = (descriptions: readonly { readonly id: string; readonly description: string | null }[]): string =>
  JSON.stringify({
    success: true,
    result: {
      datasetId: 20251,
      modifiedDate: '1951-01-02 09:58:56',
      distribution: descriptions.map((entry) => ({
        resourceFormat: 'CSV',
        resourceDescription: entry.description,
        resourceDownloadUrl: resourceUrl(entry.id),
      })),
    },
  })

/** 「現在」由測試控制（§6.2）。 */
let instant = new Date('2026-08-28T04:00:00.000Z')
const clock = clockFrom(() => instant)

type Scenario = {
  /** metadata 要列出哪些資源；預設是上面那三個。 */
  readonly resources?: readonly { readonly id: string; readonly description: string | null }[]
  /** 每個資源的內容；沒有列到的用預設的合法 CSV。 */
  readonly bodies?: Readonly<Record<string, string>>
}

type FetchLog = {
  /** 每一次 `fetch` 的網址，依呼叫順序。幂等那一條靠它證明「一份資源都沒有下載」。 */
  readonly urls: string[]
}

const defaultBody: Readonly<Record<string, string>> = {
  roc40: gradeCsv(29500),
  roc41: gradeCsv(30300),
  roc42: gradeCsv(31800),
}

const buildContext = (scenario: Scenario): { readonly context: RegulatorySyncContext; readonly fetched: FetchLog } => {
  const fetched: FetchLog = { urls: [] }
  const listed = scenario.resources ?? RESOURCES.map((entry) => ({ id: entry.id, description: entry.description }))
  const bodies = { ...defaultBody, ...scenario.bodies }

  const context: RegulatorySyncContext = {
    db: database,
    clock,
    fetch: (url) => {
      fetched.urls.push(url)
      if (url === METADATA_URL) return Promise.resolve(new Response(metadataBody(listed), { status: 200 }))
      const id = Object.keys(bodies).find((key) => url === resourceUrl(key))
      if (id !== undefined) return Promise.resolve(new Response(bodies[id], { status: 200 }))
      return Promise.resolve(new Response('not found', { status: 404 }))
    },
    // 心跳的行為由單資源那一支的測試涵蓋（同一份實作）；這裡只要一個不會真的起計時器的替身。
    startHeartbeatTimer: (_intervalMs, _tick: HeartbeatTick): StopHeartbeatTimer => () => undefined,
  }

  return { context, fetched }
}

const purge = async (): Promise<void> => {
  const versions = await database
    .select({ id: regulatoryDatasetVersions.id })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, HEALTH_INSURANCE_GRADES))
  const ids = versions.map((version) => version.id)

  await database.delete(regulatorySyncLogs).where(eq(regulatorySyncLogs.datasetCode, HEALTH_INSURANCE_GRADES))
  if (ids.length > 0) {
    await database.delete(regulatoryRecords).where(inArray(regulatoryRecords.datasetVersionId, ids))
    await database.delete(regulatoryDatasetVersions).where(inArray(regulatoryDatasetVersions.id, ids))
  }
}

const listVersionRows = async () =>
  database
    .select({
      id: regulatoryDatasetVersions.id,
      versionCode: regulatoryDatasetVersions.versionCode,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      checksum: regulatoryDatasetVersions.checksum,
      recordCount: regulatoryDatasetVersions.recordCount,
      governmentResourceId: regulatoryDatasetVersions.governmentResourceId,
      rawFormatCode: regulatoryDatasetVersions.rawFormatCode,
    })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, HEALTH_INSURANCE_GRADES))
    .orderBy(regulatoryDatasetVersions.id)

const listSyncLogRows = async () =>
  database
    .select({
      id: regulatorySyncLogs.id,
      statusCode: regulatorySyncLogs.statusCode,
      errorMessage: regulatorySyncLogs.errorMessage,
      datasetVersionId: regulatorySyncLogs.datasetVersionId,
      recordsReceived: regulatorySyncLogs.recordsReceived,
      governmentResourceId: regulatorySyncLogs.governmentResourceId,
    })
    .from(regulatorySyncLogs)
    .where(eq(regulatorySyncLogs.datasetCode, HEALTH_INSURANCE_GRADES))
    .orderBy(regulatorySyncLogs.id)

const runOnce = async (scenario: Scenario = {}) => {
  const { context, fetched } = buildContext(scenario)
  const result = await runSync(context, {
    datasetCode: HEALTH_INSURANCE_GRADES,
    triggerTypeCode: RegulatorySyncTriggerType.Scheduled,
  })
  return { result, fetched }
}

beforeEach(async () => {
  instant = new Date('2026-08-28T04:00:00.000Z')
  await purge()
})

afterAll(async () => {
  await purge()
})

describe('一次同步把所有還沒有的版本都補進來', () => {
  test('三個資源 → 三個版本，依生效日由舊到新寫入', async () => {
    const { result } = await runOnce()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.statusCode).toBe(RegulatorySyncStatus.Succeeded)
    // `recordCount` 是**本次寫入的總筆數**（跨三個版本），不是最後那一版的筆數。
    expect(result.value.recordCount).toBe(RECORDS_PER_VERSION * 3)

    const versions = await listVersionRows()
    expect(versions).toHaveLength(3)
    // metadata 的順序是 41、40、42，而寫入的順序是生效日由舊到新——於是 `id` 的順序與生效日一致。
    expect(versions.map((version) => version.versionCode)).toEqual(['1951-01', '1952-01', '1953-01'])
    expect(versions.map((version) => version.effectiveFrom)).toEqual(['1951-01-01', '1952-01-01', '1953-01-01'])
    expect(versions.every((version) => version.recordCount === RECORDS_PER_VERSION)).toBe(true)
    // CSV = 1（`RegulatoryRawFormat.Csv`）：健保署那兩份沒有 JSON 可選。
    expect(versions.every((version) => version.rawFormatCode === 1)).toBe(true)

    // ★ checksum 是**逐版本**的（每一版自己那一份內容的雜湊），不是整批一個值。
    const checksums = new Set(versions.map((version) => version.checksum))
    expect(checksums.size).toBe(3)
    // 每一版也各自記著自己是從哪一個資源抓來的。
    expect(versions.map((version) => version.governmentResourceId)).toEqual([
      resourceUrl('roc40'),
      resourceUrl('roc41'),
      resourceUrl('roc42'),
    ])

    // 同步歷程：一筆成功，`dataset_version_id` 指向生效日最新的那一版。
    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      statusCode: RegulatorySyncStatus.Succeeded,
      errorMessage: null,
      recordsReceived: RECORDS_PER_VERSION * 3,
      datasetVersionId: versions[2]?.id,
    })

    // 這才是重點：每一版都查得到，而且基準日挑到的是對的那一版（計畫 §3.2）。
    const inFirstYear = await resolveEffectiveDataset(
      { db: database },
      { datasetCode: HEALTH_INSURANCE_GRADES, asOfDate: '1951-06-01' },
    )
    expect(inFirstYear.ok).toBe(true)
    if (!inFirstYear.ok) return
    expect(inFirstYear.value.version.versionCode).toBe('1951-01')
    expect(inFirstYear.value.records).toHaveLength(RECORDS_PER_VERSION)
    // 值是 decimal 字串，不是 number（§4.7、計畫 §6.1）。
    const lowest = inFirstYear.value.records.find((record) => record.recordKey === 'amount-29500')
    expect(lowest?.amount).toBe('29500.0000')
    expect(typeof lowest?.amount).toBe('string')

    const inThirdYear = await resolveEffectiveDataset(
      { db: database },
      { datasetCode: HEALTH_INSURANCE_GRADES, asOfDate: '1953-06-01' },
    )
    expect(inThirdYear.ok && inThirdYear.value.version.versionCode).toBe('1953-01')
  })
})

describe('★ 幂等：跑第二次不重複建版本', () => {
  test('全部都已經存在 → status=4 無異動，而且一份資源都沒有下載', async () => {
    const first = await runOnce()
    expect(first.result.ok).toBe(true)
    const before = await listVersionRows()

    instant = new Date(instant.getTime() + 3600_000)
    const second = await runOnce()

    expect(second.result.ok).toBe(true)
    if (!second.result.ok) return
    expect(second.result.value.statusCode).toBe(RegulatorySyncStatus.NoChange)
    // 指向既有的最新版，語意與單資源那條路的無異動逐字相同。
    expect(second.result.value.datasetVersionId).toBe(before[2]?.id ?? null)
    expect(second.result.value.recordCount).toBeNull()

    // ★ 版本一個都沒有多，而且**連 id 都沒有變**（沒有刪掉重建）。
    expect(await listVersionRows()).toEqual(before)

    // ★ 第二次只打了 metadata API 一次，一個資源都沒有下載——幂等的判定材料全部來自 metadata。
    expect(second.fetched.urls).toEqual([METADATA_URL])

    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(2)
    expect(logs[1]?.statusCode).toBe(RegulatorySyncStatus.NoChange)
    expect(logs[1]?.errorMessage).toBeNull()
  })

  test('已經有一半時，只補沒有的那一半', async () => {
    // 先只給兩個資源，再給三個：第二次應該只新建第三個。
    const twoOnly = RESOURCES.slice(0, 2).map((entry) => ({ id: entry.id, description: entry.description }))
    const first = await runOnce({ resources: twoOnly })
    expect(first.result.ok).toBe(true)
    expect(await listVersionRows()).toHaveLength(2)

    instant = new Date(instant.getTime() + 3600_000)
    const second = await runOnce()

    expect(second.result.ok).toBe(true)
    if (!second.result.ok) return
    expect(second.result.value.statusCode).toBe(RegulatorySyncStatus.Succeeded)
    // 只寫了一個版本的筆數，不是三個版本的。
    expect(second.result.value.recordCount).toBe(RECORDS_PER_VERSION)
    expect(second.result.value.versionCode).toBe('1953-01')

    const versions = await listVersionRows()
    expect(versions).toHaveLength(3)
    // 只下載了那一個新資源（另外兩個已存在的一份都沒抓）。
    expect(second.fetched.urls).toEqual([METADATA_URL, resourceUrl('roc42')])
  })
})

describe('★ 一個版本失敗，其餘仍然寫入', () => {
  test('中間那一份內容壞掉：另外兩版照樣進資料庫，整體 status=3', async () => {
    const { result } = await runOnce({ bodies: { roc41: BROKEN_CSV } })

    // 有東西沒進來就是紅的，即使同一次也補進了兩個版本。
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe('regulatory.sync.errors.sync-failed')

    // ★ 另外兩個版本**留在資料庫裡**：每個版本各自一個交易，一個失敗不會把已成功的一起回捲。
    const versions = await listVersionRows()
    expect(versions.map((version) => version.versionCode)).toEqual(['1951-01', '1953-01'])

    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    // `records_received` 記的是**真的寫進去的筆數**，於是「失敗了、但補進來兩個版本」看得出來。
    expect(logs[0]?.recordsReceived).toBe(RECORDS_PER_VERSION * 2)
    // `error_message` 要有摘要（幾個新建、幾個已存在、幾個失敗）＋ 是哪一個資源壞了。
    expect(logs[0]?.errorMessage).toContain('新建 2 個版本')
    expect(logs[0]?.errorMessage).toContain('失敗 1 個')
    expect(logs[0]?.errorMessage).toContain('41年1月全民健康保險投保金額分級表')
    expect(logs[0]?.errorMessage).toContain('缺口')

    // 失敗的那一版下一次還會再試（幂等只跳過**已經寫進去**的版本）。
    instant = new Date(instant.getTime() + 3600_000)
    const retried = await runOnce()
    expect(retried.result.ok).toBe(true)
    expect(await listVersionRows()).toHaveLength(3)
  })

  test('★ 推導不出生效日的資源：那個版本失敗，其餘照樣寫入，而且不猜（計畫 §7.2）', async () => {
    const { result } = await runOnce({
      resources: [
        { id: 'roc40', description: '40年1月全民健康保險投保金額分級表' },
        // 政府的年度標示：只有年份、沒有月份。實測 `20251` 有九個資源長這樣。
        { id: 'roc41', description: '41年全民健康保險投保金額分級表' },
        // 完全沒有說明。
        { id: 'roc42', description: null },
      ],
    })

    expect(result.ok).toBe(false)

    // 推導得出來的那一個進來了；推導不出來的兩個**一個版本都沒有建**
    // ——不是「建一個生效日是今天的版本」，也不是「當成 1 月 1 日」。
    const versions = await listVersionRows()
    expect(versions.map((version) => version.versionCode)).toEqual(['1951-01'])

    const logs = await listSyncLogRows()
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[0]?.errorMessage).toContain('只有年份')
    expect(logs[0]?.errorMessage).toContain('沒有給資源說明')
    // 推導不出來的那兩個**連下載都沒有**：計畫階段就出局了。
  })
})

describe('resource discovery 本身壞掉時，一個版本都不建', () => {
  test('metadata 裡沒有 CSV 資源 → status=3', async () => {
    const { context } = buildContext({})
    const noCsv: RegulatorySyncContext = {
      ...context,
      fetch: (url) =>
        url === METADATA_URL
          ? Promise.resolve(
              new Response(
                JSON.stringify({ result: { distribution: [{ resourceFormat: 'JSON', resourceDownloadUrl: 'x' }] } }),
                { status: 200 },
              ),
            )
          : Promise.resolve(new Response('not found', { status: 404 })),
    }

    const result = await runSync(noCsv, {
      datasetCode: HEALTH_INSURANCE_GRADES,
      triggerTypeCode: RegulatorySyncTriggerType.Scheduled,
    })

    expect(result.ok).toBe(false)
    expect(await listVersionRows()).toEqual([])
    const logs = await listSyncLogRows()
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[0]?.errorMessage).toContain('CSV')
  })
})
