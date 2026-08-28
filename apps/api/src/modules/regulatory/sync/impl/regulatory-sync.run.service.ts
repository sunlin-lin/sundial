/**
 * 業務動作：對一個資料集執行一次同步（計畫 §7.1 的流程圖）。
 *
 * ```
 * 判死心跳逾時的舊紀錄 → 還有活著的就拒絕
 *   → 建 sync_log（status=1 執行中，心跳啟動）
 *   → resource discovery（打 data.gov.tw metadata API）
 *   → 下載 raw
 *   → checksum 比對該資料集最新版本 → 相同則 status=4 無異動，結束
 *   → 解析 → records（依 §6 的形狀驗證）
 *   → 決定 version_code 與 effective_from
 *        └─ 推導不出來 → status=3 失敗，結束（§7.2）
 *   → 同一交易寫入 version ＋ records
 *   → status=2
 * ```
 *
 * ## 這一支沒有對應的端點，而那是刻意的（計畫 D3）
 *
 * `/regulatory/sync/trigger` **不開放**：觸發全平台同步不該由某一家公司的管理者做
 * （按一個鈕，平台上每一家公司的 Payroll 都跟著換版本），而平台管理員這個角色還不存在。
 * 因此本動作的呼叫者是伺服器端的程序。§0.4 明文：「沒有端點的業務動作一樣放在入口檔」。
 *
 * ## 三條規則在這個檔案裡是硬的
 *
 * 1. **推導不出生效日一律失敗，不得猜**（§7.2）。本檔沒有任何一行拿 `clock` 去補 `effective_from`
 *    ——解析器的簽章裡根本沒有時間（見 `domain/regulatory-sync-model.ts` 的 `RegulatoryDatasetParser`）。
 * 2. **任何失敗都不得動到已存在的有效版本**（字典）。失敗路徑只寫 `regulatory_sync_logs` 一張表；
 *    版本與 records 只在最後一步、同一個交易內一起寫入，中途失敗整批回滾。
 * 3. **心跳由獨立計時器驅動**（§3.4）。本檔一次都沒有主動呼叫過那個 tick。
 *
 * ## 交易內不做外部 IO（§3.4）
 *
 * 下載與解析全部發生在交易之前。交易期間持有列鎖，一次外部逾時就會連鎖鎖住整張表——
 * 而政府端點回應緩慢正是本模組的常態情境（它就是 §3.4 拿來說明心跳的那個例子）。
 */
import { RegulatorySyncStatus } from '../../../../db/schema/index.ts'
import { LogCategory, logger } from '../../../../shared/logger.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { parseRegulatoryRecordData } from '../../datasets/domain/regulatory-record-shape.ts'
import { selectDataGovResource, toDataGovMetadataUrl } from '../domain/regulatory-data-gov.ts'
import { toContentChecksum } from '../domain/regulatory-sync-checksum.ts'
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_SECONDS,
  isHeartbeatStale,
  RESOURCE_FETCH_TIMEOUT_MS,
  type ParsedRegulatoryRecord,
  type RegulatorySyncContext,
  type RegulatorySyncSource,
  type RunSyncInput,
  type StopHeartbeatTimer,
  type SyncOutcome,
} from '../domain/regulatory-sync-model.ts'
import {
  REGULATORY_SYNC_SOURCES,
  toVersionCode,
  type SyncableDatasetCode,
} from '../domain/regulatory-sync-source.ts'
import { regulatorySyncAlreadyRunning, regulatorySyncFailed } from '../regulatory-sync.errors.ts'
import {
  completeSyncLog,
  createSyncLog,
  failStaleSyncLogs,
  findDatasetVersionByCode,
  findLatestDatasetVersion,
  insertDatasetVersion,
  insertRegulatoryRecords,
  listRunningSyncLogs,
  touchSyncLogHeartbeat,
} from '../regulatory-sync.repository.ts'

/** 判死時寫進 `error_message` 的原因。固定字串，因為原因就是同一個。 */
const HEARTBEAT_TIMEOUT_MESSAGE = `心跳逾時：超過 ${String(HEARTBEAT_TIMEOUT_SECONDS)} 秒沒有更新 heartbeat_at，判定同步程序已中斷`

/** 下載結果。連不上與非 2xx 都收斂成 `reason`，理由見 {@link fetchText}。 */
type FetchOutcome = { readonly ok: true; readonly body: string } | { readonly ok: false; readonly reason: string }

/**
 * 打一次政府端點並取回內容。
 *
 * **把連線失敗轉成 `reason` 不算「吞掉例外」**（§3.3）：政府端點連不上、逾時、回 503，
 * 這些是同步這件事**預期中**的失敗模式，不是程式錯誤。它們的正確歸宿是
 * `regulatory_sync_logs.error_message`（有人會去看、可以追查是哪一天開始連不上），
 * 而不是一個往上冒到排程器的例外。真正沒有預期到的例外仍然照原樣往上拋，見 {@link runSync}。
 *
 * `AbortSignal.timeout` 是必要的：沒有逾時的 `fetch` 在對方半開連線時會**永遠**掛著，
 * 而心跳照樣跳——那筆紀錄會永遠停在執行中，連逾時判定都救不了它。
 */
const fetchText = async (context: RegulatorySyncContext, url: string, label: string): Promise<FetchOutcome> => {
  try {
    const response = await context.fetch(url, { signal: AbortSignal.timeout(RESOURCE_FETCH_TIMEOUT_MS) })
    if (!response.ok) {
      return { ok: false, reason: `${label}回應 HTTP ${String(response.status)}：${url}` }
    }
    return { ok: true, body: await response.text() }
  } catch (error) {
    return { ok: false, reason: `${label}連線失敗（${error instanceof Error ? error.message : String(error)}）：${url}` }
  }
}

/**
 * 把心跳逾時的舊紀錄判死，並回報「是否還有活著的同步」。
 *
 * 這是同步流程的第一步，也是計畫 §3.4 那個失敗模式的解藥：程序被殺掉（部署、OOM、機器重啟）
 * 之後，那一筆會永遠停在 `status_code=1`，而下一次排程看到「已有執行中的同步」就會跳過
 * ——**從此再也不同步，且沒有任何錯誤**。
 *
 * @returns 仍然活著的那一筆（心跳還在跳）；沒有就是 `null`。
 */
const reapAndFindLiveSync = async (
  context: RegulatorySyncContext,
  datasetCode: number,
): Promise<{ readonly id: number } | null> => {
  const running = await listRunningSyncLogs(context.db, datasetCode)
  if (running.length === 0) return null

  const now = context.clock.now()
  // 門檻＝現在往回推三個心跳週期。用 clock 產生（§6.2），本檔不做任何日期運算：
  // `after(-N)` 與 `after(N)` 是同一段格式化，於是門檻與 `heartbeat_at` 的格式必然一致
  //（兩者格式不同時，下面那個字串比較會靜靜地永遠成立或永遠不成立）。
  const staleBefore = context.clock.after(-HEARTBEAT_TIMEOUT_SECONDS)

  const staleIds = running.filter((log) => isHeartbeatStale(log.heartbeatAt, staleBefore)).map((log) => log.id)
  if (staleIds.length > 0) {
    const reaped = await failStaleSyncLogs(context.db, {
      ids: staleIds,
      finishedAt: now,
      errorMessage: HEARTBEAT_TIMEOUT_MESSAGE,
    })
    // 這件事要留在 log 裡：一個資料集反覆被判死，代表那台機器上的同步程序一直在被殺掉，
    // 而只看資料表的話這件事會被埋在幾百列歷程裡。
    logger.warn(LogCategory.UnhandledException, '心跳逾時的同步紀錄已判定為失敗', {
      datasetCode,
      syncLogIds: staleIds,
      reapedRows: reaped,
    })
  }

  const stillAlive = running.find((log) => !isHeartbeatStale(log.heartbeatAt, staleBefore))
  return stillAlive === undefined ? null : { id: stillAlive.id }
}

/** 這一次同步在 `regulatory_sync_logs` 上的結案動作。 */
type SyncLogClosure = {
  readonly statusCode: typeof RegulatorySyncStatus.Succeeded | typeof RegulatorySyncStatus.NoChange | typeof RegulatorySyncStatus.Failed
  readonly datasetVersionId: number | null
  readonly governmentResourceId: string | null
  readonly recordsReceived: number | null
  readonly errorMessage: string | null
}

/**
 * 結案，並在「這一列已經不是執行中」時留下一筆 log。
 *
 * 影響 0 列代表本程序在執行途中被下一次同步判死了（心跳停了三分鐘以上）。這件事在正常運作下
 * 不會發生，發生了就代表事件迴圈被卡住或機器負載異常——**而且它有實際後果**：
 * 另一個程序可能同時在寫同一個資料集。因此它走 `logger.error`（會進告警），不是靜靜略過。
 */
const closeSyncLog = async (
  context: RegulatorySyncContext,
  syncLogId: number,
  closure: SyncLogClosure,
): Promise<void> => {
  const affected = await completeSyncLog(context.db, {
    id: syncLogId,
    statusCode: closure.statusCode,
    finishedAt: context.clock.now(),
    datasetVersionId: closure.datasetVersionId,
    governmentResourceId: closure.governmentResourceId,
    recordsReceived: closure.recordsReceived,
    errorMessage: closure.errorMessage,
  })

  if (affected === 0) {
    logger.error(LogCategory.UnhandledException, '同步紀錄結案時已不是執行中，可能已被心跳逾時判定為失敗', {
      syncLogId,
      intendedStatusCode: closure.statusCode,
      datasetVersionId: closure.datasetVersionId,
    })
  }
}

/** 中途失敗的收斂：寫 `status=3` ＋ `error_message`，回 `ServiceResult` 的失敗分支。 */
const failSync = async (
  context: RegulatorySyncContext,
  datasetCode: SyncableDatasetCode,
  syncLogId: number,
  governmentResourceId: string | null,
  reason: string,
): Promise<ServiceResult<SyncOutcome>> => {
  await closeSyncLog(context, syncLogId, {
    statusCode: RegulatorySyncStatus.Failed,
    datasetVersionId: null,
    governmentResourceId,
    recordsReceived: null,
    errorMessage: reason,
  })
  return fail([regulatorySyncFailed(datasetCode, syncLogId, reason)])
}

/**
 * 寫入前的形狀驗證（計畫 §6：一個 `dataset_code` 對應一個 TypeBox schema，寫入前驗證、讀出後也驗證）。
 *
 * 解析器產出的 `data` 在型別上已經是對的，這一步看似多餘——它擋的是**型別擋不到的那一半**：
 * decimal 字串的 pattern（`29500` 是對的、`2.95e4` 不是）、字面值聯集的實際值。
 * 少了它，一個回傳 `String(Number(x))` 的解析器改動會**通過編譯**，然後把 `2.95e4`
 * 寫進資料庫，而讀出後的驗證要幾個月後才會發現（那時已經有人拿它算過薪水）。
 */
const validateRecordShapes = (
  datasetCode: SyncableDatasetCode,
  records: readonly ParsedRegulatoryRecord[],
): string | null => {
  for (const record of records) {
    const parsed = parseRegulatoryRecordData(datasetCode, record.data)
    if (!parsed.ok) return `record_key=${record.recordKey} 的 data 未通過形狀驗證：${parsed.reason}`
  }
  return null
}

/**
 * 同步的主體。由 {@link runSync} 在心跳啟動之後呼叫。
 *
 * 拆出來的理由是 `finally`：心跳一旦啟動就必須停掉，而把整段流程寫在 `try` 裡會讓
 * 「哪些步驟在心跳的保護範圍內」變成要靠縮排判斷的事。
 */
const executeSync = async (
  context: RegulatorySyncContext,
  datasetCode: SyncableDatasetCode,
  source: RegulatorySyncSource,
  syncLogId: number,
): Promise<ServiceResult<SyncOutcome>> => {
  // ① resource discovery：`government_resource_id` 不得硬編（計畫 §7.0）。
  const metadataUrl = toDataGovMetadataUrl(source.datasetId)
  const metadata = await fetchText(context, metadataUrl, 'metadata API ')
  if (!metadata.ok) return failSync(context, datasetCode, syncLogId, null, metadata.reason)

  const resource = selectDataGovResource(metadata.body, source.resourceFormat)
  if (!resource.ok) return failSync(context, datasetCode, syncLogId, null, resource.reason)

  const resourceUrl = resource.value.downloadUrl

  // ② 下載 raw。
  const downloaded = await fetchText(context, resourceUrl, '資源下載')
  if (!downloaded.ok) return failSync(context, datasetCode, syncLogId, resourceUrl, downloaded.reason)

  const rawText = downloaded.body
  const checksum = toContentChecksum(rawText)

  // ③ checksum 比對該資料集最新版本 → 相同則 `status=4 無異動`，結束。
  const latest = await findLatestDatasetVersion(context.db, datasetCode)
  if (latest !== null && latest.checksum === checksum) {
    await closeSyncLog(context, syncLogId, {
      statusCode: RegulatorySyncStatus.NoChange,
      // 指向**既有的**那一版：「這次同步確認了現行版本仍然是最新的」，那個資訊比 NULL 有用。
      datasetVersionId: latest.id,
      governmentResourceId: resourceUrl,
      recordsReceived: null,
      errorMessage: null,
    })
    return succeed({
      syncLogId,
      datasetCode,
      statusCode: RegulatorySyncStatus.NoChange,
      datasetVersionId: latest.id,
      versionCode: latest.versionCode,
      effectiveFrom: latest.effectiveFrom,
      recordCount: null,
      governmentResourceId: resourceUrl,
    })
  }

  // ④ 解析。生效日推導不出來就在這一步失敗（§7.2），不會走到寫入。
  const parsed = source.parse(rawText)
  if (!parsed.ok) return failSync(context, datasetCode, syncLogId, resourceUrl, `解析失敗：${parsed.reason}`)

  if (parsed.records.length === 0) {
    return failSync(context, datasetCode, syncLogId, resourceUrl, '解析結果沒有任何 record，不寫入空版本')
  }

  const shapeError = validateRecordShapes(datasetCode, parsed.records)
  if (shapeError !== null) return failSync(context, datasetCode, syncLogId, resourceUrl, shapeError)

  // ⑤ 決定 `version_code`。撞既有版本代碼時**失敗，而不是覆寫或另取一個代碼**：
  // 覆寫會改寫已結算 Payroll 引用的那一版（字典明文禁止），另取代碼則會產生兩個同日生效的版本。
  const versionCode = toVersionCode(parsed.effectiveFrom)
  const existing = await findDatasetVersionByCode(context.db, datasetCode, versionCode)
  if (existing !== null) {
    return failSync(
      context,
      datasetCode,
      syncLogId,
      resourceUrl,
      `版本代碼 ${versionCode}（生效日 ${parsed.effectiveFrom}）已存在（id=${String(existing.id)}），` +
        `但內容 checksum 不同（既有 ${existing.checksum.slice(0, 12)}…／本次 ${checksum.slice(0, 12)}…）。` +
        '政府在同一個生效月份內改了內容，需要人工確認要不要建立新版本。',
    )
  }

  // ⑥ 同一交易寫入 version ＋ records（計畫 §7.1、§4.4）。
  const now = context.clock.now()
  const datasetVersionId = await context.db.transaction(async (tx): Promise<number> => {
    const versionId = await insertDatasetVersion(tx, {
      datasetCode,
      versionCode,
      effectiveFrom: parsed.effectiveFrom,
      governmentResourceId: resourceUrl,
      sourceModifiedAt: resource.value.sourceModifiedAt,
      syncedAt: now,
      checksum,
      recordCount: parsed.records.length,
      rawFormatCode: source.rawFormatCode,
      // 保存原始 Snapshot，不是解析結果：政府資料格式變動時，沒有它就只能重新去抓，
      // 而舊資源網址那時多半已經失效。
      rawData: rawText,
      createdAt: now,
    })

    await insertRegulatoryRecords(
      tx,
      parsed.records.map((record) => ({
        datasetVersionId: versionId,
        recordKey: record.recordKey,
        code: record.code,
        name: record.name,
        rangeFrom: record.rangeFrom,
        rangeTo: record.rangeTo,
        amount: record.amount,
        rate: record.rate,
        data: record.data,
        sortOrder: record.sortOrder,
        createdAt: now,
      })),
    )

    return versionId
  })

  await closeSyncLog(context, syncLogId, {
    statusCode: RegulatorySyncStatus.Succeeded,
    datasetVersionId,
    governmentResourceId: resourceUrl,
    recordsReceived: parsed.records.length,
    errorMessage: null,
  })

  return succeed({
    syncLogId,
    datasetCode,
    statusCode: RegulatorySyncStatus.Succeeded,
    datasetVersionId,
    versionCode,
    effectiveFrom: parsed.effectiveFrom,
    recordCount: parsed.records.length,
    governmentResourceId: resourceUrl,
  })
}

export const runSync = async (
  context: RegulatorySyncContext,
  input: RunSyncInput<SyncableDatasetCode>,
): Promise<ServiceResult<SyncOutcome>> => {
  const source: RegulatorySyncSource = REGULATORY_SYNC_SOURCES[input.datasetCode]

  const live = await reapAndFindLiveSync(context, input.datasetCode)
  if (live !== null) return fail([regulatorySyncAlreadyRunning(input.datasetCode, live.id)])

  const startedAt = context.clock.now()
  const syncLogId = await createSyncLog(context.db, {
    datasetCode: input.datasetCode,
    triggerTypeCode: input.triggerTypeCode,
    statusCode: RegulatorySyncStatus.Running,
    startedAt,
  })

  // 心跳：**獨立計時器，不綁在工作步驟上**（§3.4）。下面這個 `tick` 在本檔的其餘部分
  // 一次都沒有被呼叫過——那正是這條規則的落點。
  //
  // `stopHeartbeat` 先給一個 no-op 再覆寫：`tick` 需要引用它（心跳發現這一列已經不是執行中時
  // 要自己停掉），而 `startHeartbeatTimer` 又需要 `tick`。用一個會拋 TDZ 的 `const` 相互引用
  // 會在「計時器在同一個 tick 內就擊發」的實作下當場炸掉。
  let stopHeartbeat: StopHeartbeatTimer = () => undefined
  const tick = async (): Promise<void> => {
    try {
      const affected = await touchSyncLogHeartbeat(context.db, syncLogId, context.clock.now())
      if (affected === 0) {
        // 這一列已經不是執行中（被判死或已結案）。繼續每 60 秒空打一次 UPDATE 沒有意義，
        // 而讓計時器留著會在程序結束時多留一個 handle。
        stopHeartbeat()
      }
    } catch (error) {
      // 心跳失敗不能中斷同步（那會讓一次暫時性的資料庫抖動變成一次同步失敗），
      // 但也不能靜靜吃掉（§3.3）：連續失敗到超過三個週期，這個程序就會被下一次同步判死。
      logger.error(LogCategory.UnhandledException, '心跳更新失敗', {
        syncLogId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  stopHeartbeat = context.startHeartbeatTimer(HEARTBEAT_INTERVAL_MS, tick)

  try {
    return await executeSync(context, input.datasetCode, source, syncLogId)
  } catch (error) {
    // 未預期的例外（資料庫斷線、本模組的 bug）**不轉成業務錯誤**（§3.1.2）：它照原樣往上拋，
    // 才會帶著堆疊進告警。但在拋出去之前要先把這一列結案——否則它會停在「執行中」，
    // 而唯一會發現它的是三分鐘後的下一次同步（那時 `error_message` 只會寫「心跳逾時」，
    // 真正的成因就此消失）。
    const reason = `未預期的例外：${error instanceof Error ? error.message : String(error)}`
    try {
      await closeSyncLog(context, syncLogId, {
        statusCode: RegulatorySyncStatus.Failed,
        datasetVersionId: null,
        governmentResourceId: null,
        recordsReceived: null,
        errorMessage: reason,
      })
    } catch (closeError) {
      // 結案本身也失敗（多半是資料庫真的掛了）。**記下來但不取代原始例外**：
      // 往上拋的必須是最初的成因，不是「我在記錄成因時又失敗了」。
      logger.error(LogCategory.UnhandledException, '同步失敗後連結案都寫不進去', {
        syncLogId,
        error: closeError instanceof Error ? closeError.message : String(closeError),
      })
    }
    throw error
  } finally {
    stopHeartbeat()
  }
}
