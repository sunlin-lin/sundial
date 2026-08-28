/**
 * `runSync` 的整合測試：真的寫進測試資料庫，走的是正式的那一條路（§7.3）。
 *
 * ## 被替換掉的只有網路與計時器，不是被測邏輯本身
 *
 * §7.3 禁止 mock 掉**被測邏輯**（「把額度計算 mock 起來去測那支呼叫它的端點，測到的只有 mock」）。
 * 這裡替換的是 `fetch` 與心跳計時器——它們不是本模組的業務規則，而且兩者都是**注入的函式型別**
 * （見 `domain/regulatory-sync-model.ts`），不是被攔截的模組。解析、生效日推導、checksum 比對、
 * 交易寫入、心跳逾時判定全部跑真的那一份。
 *
 * 真的打政府端點的那一條不在 `bun run test` 裡，是獨立指令 `bun run check:live-sources`
 * （理由見 `apps/api/scripts/check-live-sources.ts` 檔頭）。
 *
 * ## 測試資料隔離：三張表沒有 `company_id`（§7.4）
 *
 * 法規三表是**平台全域**資料（計畫 §3.2 (b)），其他模組慣用的「每條測試自建一家公司」在這裡
 * 沒有對應物。本檔改用**保留鍵空間**：全部測試資料都掛在 `dataset_code = 1`，
 * 而那個資料集在測試資料庫裡沒有任何 migration 帶進來的資料（只有 `10` 有，來自 `0015`）。
 * 每條測試前後各清一次，`beforeEach` 那一次是為了讓上一輪中途崩潰留下的殘骸不影響斷言。
 *
 * **`afterAll` 的清除不能省**：本檔寫的版本 `effective_to` 是 NULL（計畫 §3.2 (d)），
 * 因此它涵蓋所有比生效日晚的日期——留著會讓 `datasets` 那一側
 * 「尚未有任何版本的資料集回 data:null」那條測試看到一個版本。
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
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
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_SECONDS, runSync } from '../regulatory-sync.service.ts'

/**
 * 直接讀環境變數組出資料庫設定，不走 `shared/config.ts`（同 `datasets` 那一側的理由）：
 * `loadConfig()` 會一併要求與本測試無關的變數，少一個就讓整批測試以看不出成因的訊息失敗。
 * 連的是不是測試資料庫由 `test-setup.ts` 的 preload 守衛（§7.4）。
 */
const database: Database = createDatabase({
  host: process.env['DB_HOST'] ?? '127.0.0.1',
  port: Number(process.env['DB_PORT'] ?? '3306'),
  user: process.env['DB_USER'] ?? '',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? '',
})

/** 本檔全部資料掛在這個資料集底下（見檔頭的隔離說明）。 */
const LABOR_INSURANCE_SALARY = 1

/** 假的資源網址。真的那一個帶隨機尾碼，每次同步重新探索（計畫 §7.0）。 */
const RESOURCE_URL = 'https://apiservice.test.invalid/OdService/download/TEST-020014-aaa'
const METADATA_URL = 'https://data.gov.tw/api/v2/rest/dataset/6258'

/**
 * 測試用的生效日：民國 40 年（西元 1951）。
 *
 * 刻意用一個**真實法規不可能落在的年份**：政府那一份的 `適用起日` 是民國 115 年，
 * 而 1951 年的版本即使因為某次崩潰沒被清掉，也不會與任何真實資料撞 `version_code`。
 */
const ROC_EFFECTIVE_FROM = '0400101'
const EXPECTED_EFFECTIVE_FROM = '1951-01-01'
const EXPECTED_VERSION_CODE = '1951-01'

const metadataBody = JSON.stringify({
  success: true,
  result: {
    datasetId: 6258,
    modifiedDate: '1951-01-02 09:58:56',
    distribution: [
      { resourceFormat: 'CSV', resourceDownloadUrl: `${RESOURCE_URL}-csv` },
      { resourceFormat: 'JSON', resourceDescription: '測試資源', resourceDownloadUrl: RESOURCE_URL },
    ],
  },
})

const salaryRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  適用起日: ROC_EFFECTIVE_FROM,
  序號: '1',
  身分別: '一般勞工',
  投保薪資等級: '1',
  月薪資總額: '29500元以下',
  月投保薪資: '29500',
  ...overrides,
})

/**
 * 「一般勞工」以外的三種身分別各一列。
 *
 * **每一份要成功解析的 payload 都必須帶上它們**：解析器要求四種投保身分別齊全，缺一種即整批失敗
 *（政府整類刪除是法規變更，見 `domain/regulatory-labor-insurance-salary.ts` 的完整性檢查）。
 * 少了它們的 payload 會在解析階段就失敗，於是本檔想驗的事（寫入、checksum 比對、版本代碼碰撞…）
 * 一件都走不到——而失敗訊息會指向身分別，看起來像是測試資料寫錯，不像規則生效。
 */
const otherCategoryRows = [
  salaryRow({ 序號: '4', 身分別: '庇護性身心障礙者', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
  salaryRow({ 序號: '5', 身分別: '部分工時勞工', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
  salaryRow({ 序號: '6', 身分別: '職訓機構受訓者', 投保薪資等級: '1', 月薪資總額: '11100元以下', 月投保薪資: '11100' }),
]

/** 一份**身分別齊全**的 payload：給幾列「一般勞工」，其餘三類自動補上。 */
const payloadOf = (...generalRows: readonly Record<string, unknown>[]): string =>
  JSON.stringify([...generalRows, ...otherCategoryRows])

/** 預設 payload：一般勞工三級 ＋ 其餘三類各一級 = 6 筆。 */
const defaultPayload = payloadOf(
  salaryRow(),
  salaryRow({ 序號: '2', 投保薪資等級: '2', 月薪資總額: '29501元至30300元', 月投保薪資: '30300' }),
  salaryRow({ 序號: '3', 投保薪資等級: '3', 月薪資總額: '30301元以上', 月投保薪資: '31800' }),
)

/** {@link defaultPayload} 的筆數。散落在下面好幾條斷言裡，寫成常數才不會改了一處漏三處。 */
const DEFAULT_RECORD_COUNT = 6

/** 「現在」由測試控制（§6.2）。心跳逾時的判定完全靠它，不靠 `sleep`。 */
let instant = new Date('2026-08-28T04:00:00.000Z')
const clock = clockFrom(() => instant)
const advanceSeconds = (seconds: number): void => {
  instant = new Date(instant.getTime() + seconds * 1000)
}

type TimerSpy = {
  /** 計時器要求的週期。斷言它等於 60 秒（計畫 §3.4）。 */
  intervalMs: number | null
  /** 計時器拿到的 tick。**同步流程自己一次都不會呼叫它**——那正是「獨立計時器」的意思。 */
  tick: HeartbeatTick | null
  stopped: number
}

type SyncScenario = {
  readonly payload?: string
  readonly metadata?: string
  /** 資源下載進行中要做的事（用來模擬「計時器在一個長步驟中間擊發」）。 */
  readonly onDownload?: () => Promise<void>
  /** 下載回應的 HTTP 狀態，預設 200。 */
  readonly downloadStatus?: number
}

const buildContext = (
  scenario: SyncScenario,
): { readonly context: RegulatorySyncContext; readonly timer: TimerSpy } => {
  const timer: TimerSpy = { intervalMs: null, tick: null, stopped: 0 }

  const context: RegulatorySyncContext = {
    db: database,
    clock,
    fetch: async (url) => {
      if (url === METADATA_URL) return new Response(scenario.metadata ?? metadataBody, { status: 200 })
      if (url === RESOURCE_URL) {
        await scenario.onDownload?.()
        return new Response(scenario.payload ?? defaultPayload, { status: scenario.downloadStatus ?? 200 })
      }
      return new Response('not found', { status: 404 })
    },
    startHeartbeatTimer: (intervalMs, tick): StopHeartbeatTimer => {
      timer.intervalMs = intervalMs
      timer.tick = tick
      return () => {
        timer.stopped += 1
      }
    },
  }

  return { context, timer }
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

const listSyncLogRows = async () =>
  database
    .select({
      id: regulatorySyncLogs.id,
      statusCode: regulatorySyncLogs.statusCode,
      errorMessage: regulatorySyncLogs.errorMessage,
      heartbeatAt: regulatorySyncLogs.heartbeatAt,
      startedAt: regulatorySyncLogs.startedAt,
      finishedAt: regulatorySyncLogs.finishedAt,
      datasetVersionId: regulatorySyncLogs.datasetVersionId,
      recordsReceived: regulatorySyncLogs.recordsReceived,
      governmentResourceId: regulatorySyncLogs.governmentResourceId,
    })
    .from(regulatorySyncLogs)
    .where(eq(regulatorySyncLogs.datasetCode, LABOR_INSURANCE_SALARY))
    .orderBy(regulatorySyncLogs.id)

const listVersionRows = async () =>
  database
    .select({
      id: regulatoryDatasetVersions.id,
      versionCode: regulatoryDatasetVersions.versionCode,
      effectiveFrom: regulatoryDatasetVersions.effectiveFrom,
      effectiveTo: regulatoryDatasetVersions.effectiveTo,
      checksum: regulatoryDatasetVersions.checksum,
      recordCount: regulatoryDatasetVersions.recordCount,
      sourceModifiedAt: regulatoryDatasetVersions.sourceModifiedAt,
      governmentResourceId: regulatoryDatasetVersions.governmentResourceId,
      rawFormatCode: regulatoryDatasetVersions.rawFormatCode,
    })
    .from(regulatoryDatasetVersions)
    .where(eq(regulatoryDatasetVersions.datasetCode, LABOR_INSURANCE_SALARY))
    .orderBy(regulatoryDatasetVersions.id)

const runOnce = async (scenario: SyncScenario = {}) => {
  const { context, timer } = buildContext(scenario)
  const result = await runSync(context, {
    datasetCode: LABOR_INSURANCE_SALARY,
    triggerTypeCode: RegulatorySyncTriggerType.Scheduled,
  })
  return { result, timer }
}

beforeEach(async () => {
  instant = new Date('2026-08-28T04:00:00.000Z')
  await purge()
})

afterAll(async () => {
  await purge()
})

describe('runSync 成功路徑', () => {
  test('版本與 records 都寫進去，而且 resolve 查得到（計畫 §7.1）', async () => {
    const { result, timer } = await runOnce()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.statusCode).toBe(RegulatorySyncStatus.Succeeded)
    expect(result.value.versionCode).toBe(EXPECTED_VERSION_CODE)
    expect(result.value.effectiveFrom).toBe(EXPECTED_EFFECTIVE_FROM)
    expect(result.value.recordCount).toBe(DEFAULT_RECORD_COUNT)
    expect(result.value.governmentResourceId).toBe(RESOURCE_URL)

    const versions = await listVersionRows()
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      versionCode: EXPECTED_VERSION_CODE,
      effectiveFrom: EXPECTED_EFFECTIVE_FROM,
      // **`effective_to` 不寫入**（計畫 §3.2 (d)）：只在政府明示失效日時才寫，
      // 不拿來記「下一版開始日的前一天」。
      effectiveTo: null,
      recordCount: DEFAULT_RECORD_COUNT,
      governmentResourceId: RESOURCE_URL,
      // 政府的 `modifiedDate` 已在解析階段當成台北牆鐘帶入（§6、計畫 §3.2）。
      sourceModifiedAt: '1951-01-02 09:58:56',
      // JSON = 2（`RegulatoryRawFormat.Json`）：日後重跑解析器時要知道 Snapshot 是什麼格式。
      rawFormatCode: 2,
    })
    // checksum 是 SHA-256 的十六進位字串。
    expect(versions[0]?.checksum).toMatch(/^[0-9a-f]{64}$/)

    // 同步歷程：一筆成功，`error_message` 是空的。
    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      statusCode: RegulatorySyncStatus.Succeeded,
      errorMessage: null,
      recordsReceived: DEFAULT_RECORD_COUNT,
      governmentResourceId: RESOURCE_URL,
      datasetVersionId: result.value.datasetVersionId,
    })
    expect(logs[0]?.finishedAt).not.toBeNull()

    // 心跳計時器：週期是 60 秒，而且同步結束時被停掉。
    expect(timer.intervalMs).toBe(HEARTBEAT_INTERVAL_MS)
    expect(timer.stopped).toBeGreaterThan(0)

    // **這才是重點：`resolve` 查得到，而且值是 decimal 字串**（§4.7、計畫 §6.1）。
    const resolved = await resolveEffectiveDataset({ db: database }, { datasetCode: 1, asOfDate: '1951-06-01' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.version.versionCode).toBe(EXPECTED_VERSION_CODE)
    expect(resolved.value.records).toHaveLength(DEFAULT_RECORD_COUNT)

    const lowest = resolved.value.records.find((record) => record.recordKey === 'general-1')
    expect(lowest).toBeDefined()
    // 讀出後的形狀驗證（計畫 §6）在 repository 那一層跑過了，因此這裡拿到的是收斂過的型別。
    expect(lowest?.rangeFrom).toBeNull()
    expect(lowest?.rangeTo).toBe('29500.0000')
    expect(lowest?.amount).toBe('29500.0000')
    expect(typeof lowest?.amount).toBe('string')

    const highest = resolved.value.records.find((record) => record.recordKey === 'general-3')
    // 最高一級沒有上限——不補一個很大的數（見形狀定義）。
    expect(highest?.rangeTo).toBeNull()

    // 生效日之前沒有版本，而且那是一筆帶錯誤碼的失敗，不是 `null`（計畫 §4.4）。
    const before = await resolveEffectiveDataset({ db: database }, { datasetCode: 1, asOfDate: '1950-12-31' })
    expect(before.ok).toBe(false)
  })
})

describe('checksum 相同 → status=4 無異動（計畫 §7.1）', () => {
  test('第二次同步不寫新版本，並指向既有的那一版', async () => {
    const first = await runOnce()
    expect(first.result.ok).toBe(true)
    const firstVersionId = first.result.ok ? first.result.value.datasetVersionId : null

    advanceSeconds(3600)
    const second = await runOnce()

    expect(second.result.ok).toBe(true)
    if (!second.result.ok) return
    expect(second.result.value.statusCode).toBe(RegulatorySyncStatus.NoChange)
    // 指向**既有的**那一版：「這次同步確認了現行版本仍然是最新的」，那個資訊比 NULL 有用。
    expect(second.result.value.datasetVersionId).toBe(firstVersionId)
    // 沒有解析，因此沒有筆數。
    expect(second.result.value.recordCount).toBeNull()

    // 沒有多出第二個版本——這正是這條規則存在的理由：少了它，每天的排程都會寫一個
    // 內容完全相同的新版本，一年 365 列同日生效的版本。
    expect(await listVersionRows()).toHaveLength(1)

    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(2)
    expect(logs[1]?.statusCode).toBe(RegulatorySyncStatus.NoChange)
    expect(logs[1]?.errorMessage).toBeNull()
  })
})

describe('失敗一律 status=3，且不得動到已存在的有效版本（字典）', () => {
  /** 既有版本的快照，用來證明失敗沒有動到它。 */
  const snapshotExistingVersion = async () => {
    const versions = await listVersionRows()
    const records = await database
      .select({ id: regulatoryRecords.id, recordKey: regulatoryRecords.recordKey })
      .from(regulatoryRecords)
      .where(inArray(regulatoryRecords.datasetVersionId, versions.map((version) => version.id)))
    return { versions, recordIds: records.map((record) => record.id).sort((a, b) => a - b) }
  }

  test('★ 解析失敗：既有版本一列都沒有變，resolve 仍然回原本那一版', async () => {
    const seeded = await runOnce()
    expect(seeded.result.ok).toBe(true)
    const before = await snapshotExistingVersion()

    advanceSeconds(3600)
    // 政府把區間句型改成我們讀不懂的寫法。
    const broken = payloadOf(salaryRow({ 月薪資總額: '29500元以內' }))
    const { result } = await runOnce({ payload: broken })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe('regulatory.sync.errors.sync-failed')
    expect(result.errors[0]?.group).toBe('unprocessable')

    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(2)
    expect(logs[1]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[1]?.errorMessage).toContain('29500元以內')
    // 失敗也要記下當次抓到的資源網址：那是事後追查「政府那一版長什麼樣」的起點。
    expect(logs[1]?.governmentResourceId).toBe(RESOURCE_URL)

    const after = await snapshotExistingVersion()
    expect(after).toEqual(before)

    const resolved = await resolveEffectiveDataset({ db: database }, { datasetCode: 1, asOfDate: '1951-06-01' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.records).toHaveLength(DEFAULT_RECORD_COUNT)
  })

  test('★ 推導不出 effective_from：status=3，而不是拿同步當天代替（計畫 §7.2）', async () => {
    // 這是整個模組最重要的一條規則。用一份缺 `適用起日` 的假資料——政府哪天把那一欄拿掉，
    // 走 fallback 的實作會產生一個生效日 = 今天的版本，而它會**立刻**變成現行版本。
    const withoutEffectiveFrom = JSON.stringify([
      { 序號: '1', 身分別: '一般勞工', 投保薪資等級: '1', 月薪資總額: '29500元以下', 月投保薪資: '29500' },
    ])
    const { result } = await runOnce({ payload: withoutEffectiveFrom })

    expect(result.ok).toBe(false)
    if (result.ok) return

    const logs = await listSyncLogRows()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[0]?.errorMessage).toContain('適用起日')

    // **一個版本都沒有寫進去**：不是「寫了一個生效日是今天的版本」。
    expect(await listVersionRows()).toEqual([])
  })

  test('下載失敗（政府端點回 503）：status=3，錯誤原因帶得出網址', async () => {
    const { result } = await runOnce({ downloadStatus: 503 })

    expect(result.ok).toBe(false)
    const logs = await listSyncLogRows()
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[0]?.errorMessage).toContain('503')
    expect(logs[0]?.errorMessage).toContain(RESOURCE_URL)
    expect(await listVersionRows()).toEqual([])
  })

  test('版本代碼撞既有版本（同月不同內容）：status=3，不覆寫也不另取代碼', async () => {
    const seeded = await runOnce()
    expect(seeded.result.ok).toBe(true)

    advanceSeconds(3600)
    // 同一個生效日、不同內容：checksum 不同（不會走無異動），但 `version_code` 是同一個。
    const changed = payloadOf(salaryRow({ 月投保薪資: '29600' }))
    const { result } = await runOnce({ payload: changed })

    expect(result.ok).toBe(false)
    const logs = await listSyncLogRows()
    expect(logs[1]?.statusCode).toBe(RegulatorySyncStatus.Failed)
    expect(logs[1]?.errorMessage).toContain(EXPECTED_VERSION_CODE)

    // 既有版本原封不動：覆寫它等於改寫已結算 Payroll 引用的那一版（字典明文禁止）。
    const versions = await listVersionRows()
    expect(versions).toHaveLength(1)
    expect(versions[0]?.recordCount).toBe(DEFAULT_RECORD_COUNT)
  })
})

describe('心跳（計畫 §3.4、決策 D2）', () => {
  /**
   * 直接寫一列「執行中且心跳早就停了」的紀錄。
   *
   * §7.3 的**明示例外**：這種資料無法由正式流程產生——它代表一個被殺掉的程序
   * （部署、OOM、機器重啟），而那正是這一整節要測的失敗模式。
   */
  const insertDeadRunningLog = async (heartbeatAt: string): Promise<number> => {
    const [header] = await database.insert(regulatorySyncLogs).values({
      datasetCode: LABOR_INSURANCE_SALARY,
      triggerTypeCode: RegulatorySyncTriggerType.Scheduled,
      startedAt: heartbeatAt,
      finishedAt: null,
      statusCode: RegulatorySyncStatus.Running,
      datasetVersionId: null,
      governmentResourceId: null,
      recordsReceived: null,
      errorMessage: null,
      heartbeatAt,
      createdAt: heartbeatAt,
      updatedAt: heartbeatAt,
    })
    return header.insertId
  }

  test('★ 心跳逾時：判死要留下失敗紀錄，不是直接忽略', async () => {
    // 心跳停在三個週期又一秒之前。
    const deadAt = clock.after(-(HEARTBEAT_TIMEOUT_SECONDS + 1))
    const deadLogId = await insertDeadRunningLog(deadAt)

    const { result } = await runOnce()

    // 新的同步照常進行——這正是心跳機制存在的理由：少了它，那一筆會永遠停在「執行中」，
    // 於是**從此再也不同步，且沒有任何錯誤**。
    expect(result.ok).toBe(true)

    const logs = await listSyncLogRows()
    const dead = logs.find((log) => log.id === deadLogId)
    expect(dead?.statusCode).toBe(RegulatorySyncStatus.Failed)
    // **必須有 `error_message`**：靜靜略過等於少了一次失敗紀錄，
    // 而那正是事後要查「為什麼那三天沒同步」時唯一的線索（字典）。
    expect(dead?.errorMessage).toContain('心跳逾時')
    expect(dead?.finishedAt).not.toBeNull()

    // 而且新的那一筆是成功的。
    const fresh = logs.find((log) => log.id !== deadLogId)
    expect(fresh?.statusCode).toBe(RegulatorySyncStatus.Succeeded)
  })

  test('心跳只落後一個週期：程序還活著，這一次同步被拒絕，而且不留下新紀錄', async () => {
    // 「超過 3 分鐘」是嚴格大於三個週期——只漏一次心跳可能只是 GC 或 IO 卡住。
    const aliveAt = clock.after(-(HEARTBEAT_TIMEOUT_SECONDS - 1))
    const aliveLogId = await insertDeadRunningLog(aliveAt)

    const { result } = await runOnce()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.code).toBe('regulatory.sync.errors.already-running')
    // Conflict（→ 409）：這是「你要做的事與另一個正在進行的操作撞了」。
    expect(result.errors[0]?.group).toBe('conflict')
    expect(result.errors[0]?.data).toEqual({ datasetCode: 1, runningLogId: aliveLogId })

    const logs = await listSyncLogRows()
    // 只有原本那一列，沒有為這次「什麼都沒做」的嘗試多寫一列。
    expect(logs).toHaveLength(1)
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Running)
    // 而且**沒有動到**那個還活著的程序的紀錄。
    expect(logs[0]?.heartbeatAt).toBe(aliveAt)

    // 也沒有寫任何版本。
    expect(await listVersionRows()).toEqual([])
  })

  test('★ 心跳由獨立計時器驅動：同步卡在下載中間時，heartbeat_at 照樣往前走', async () => {
    // 這一條守的是計畫 §3.4 那句「心跳必須由獨立計時器驅動，不得綁在工作步驟上」。
    // 綁在工作步驟上的實作會在這裡失敗：整個下載期間一次心跳都不會發生，
    // 而 Bun 是單一事件迴圈——政府端點回應緩慢的單一 `await fetch()` 只要超過 180 秒，
    // 一個活得好好的程序就會被判死，第二個程序接手同時寫入。
    let heartbeatDuringDownload: string | null = null
    let startedAtDuringDownload: string | null = null

    const { context, timer } = buildContext({
      onDownload: async () => {
        // 模擬：下載進行到一半，時間過了兩分鐘，計時器擊發一次。
        advanceSeconds(120)
        await timer.tick?.()

        const [running] = await database
          .select({ heartbeatAt: regulatorySyncLogs.heartbeatAt, startedAt: regulatorySyncLogs.startedAt })
          .from(regulatorySyncLogs)
          .where(
            and(
              eq(regulatorySyncLogs.datasetCode, LABOR_INSURANCE_SALARY),
              eq(regulatorySyncLogs.statusCode, RegulatorySyncStatus.Running),
            ),
          )
        heartbeatDuringDownload = running?.heartbeatAt ?? null
        startedAtDuringDownload = running?.startedAt ?? null
      },
    })

    const result = await runSync(context, {
      datasetCode: LABOR_INSURANCE_SALARY,
      triggerTypeCode: RegulatorySyncTriggerType.Scheduled,
    })

    expect(result.ok).toBe(true)
    expect(startedAtDuringDownload).not.toBeNull()
    expect(heartbeatDuringDownload).not.toBeNull()
    // 心跳比 `started_at` 晚了兩分鐘——那兩分鐘裡同步一個步驟都沒有完成。
    expect(String(heartbeatDuringDownload) > String(startedAtDuringDownload)).toBe(true)
    // 同步結束後計時器被停掉，不會留下一個永遠在跑的 handle。
    expect(timer.stopped).toBeGreaterThan(0)
  })

  test('紀錄已結案之後，心跳自己停掉（不再每 60 秒空打一次 UPDATE）', async () => {
    const { result, timer } = await runOnce()
    expect(result.ok).toBe(true)

    const stoppedBefore = timer.stopped
    // 同步已經結束，這一列不是「執行中」了。再擊發一次計時器：影響 0 列 → 自己停掉。
    await timer.tick?.()
    expect(timer.stopped).toBeGreaterThan(stoppedBefore)

    // 而且沒有把已結案的紀錄「復活」成看起來還在跑的東西。
    const logs = await listSyncLogRows()
    expect(logs[0]?.statusCode).toBe(RegulatorySyncStatus.Succeeded)
  })
})
