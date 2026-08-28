/**
 * 業務動作：對一個資料集執行一次同步（計畫 §7.1 的流程圖）。
 *
 * ```
 * 判死心跳逾時的舊紀錄 → 還有活著的就拒絕
 *   → 建 sync_log（status=1 執行中，心跳啟動）
 *   → resource discovery（打 data.gov.tw metadata API）
 *   → 依來源形態分兩條（見下）
 * ```
 *
 * ## 兩條路：單資源與多資源
 *
 * ```
 * 單資源（1、3、4、6）             多資源（2、5）
 * ─────────────────────────────    ────────────────────────────────────────
 * 下載 raw                          列出該格式的全部資源（16／19 個）
 * checksum 比對最新版               每個資源由**資源說明**推導生效日 → version_code
 *   └ 相同 → status=4 無異動         排出計畫：新建／已存在跳過／推導不出來就失敗（§7.2）
 * 解析 → records（§6 形狀驗證）      逐一處理「新建」的那些：
 * 決定 version_code                   下載 → 解析 → 形狀驗證 → **各自一個交易**寫入
 *   └ 推導不出來 → status=3（§7.2）  一個版本失敗不中斷其餘
 *   └ 撞既有代碼 → status=3
 * 同一交易寫入 version ＋ records
 * status=2
 * ```
 *
 * **為什麼不是一條路**（＝把單資源當成 N=1）：兩者在一件事上有本質差異——單資源的版本代碼
 * **只有下載並解析之後才知道**（`1`、`3` 的生效日在資料列裡），多資源的**從 metadata 就知道**。
 * 合成一條的話，多資源那一邊每天晚上都得把十幾份歷史資源重新下載一次才能發現「它們早就進來了」
 * （一年七千多次請求換零個新版本）；或者要在單資源那條路上加一堆「這一次要不要下載」的分支，
 * 而那條路現在的讀法是一條直線。完整論述見 `domain/regulatory-sync-model.ts` 的 `RegulatorySyncSource`。
 *
 * ## 多版本流程的三個決定，寫在這裡因為它們只在這個檔案裡看得到
 *
 * **(1) 幂等以 `version_code` 判定，而且「已存在」代表不下載。**
 * 判定在 `domain/regulatory-multi-version-plan.ts`（純函式）。用版本代碼而不是資源網址：
 * 網址帶隨機尾碼、政府隨時可能重新編號，換一次尾碼就會讓十幾個版本全部被當成「新的」。
 *
 * **(2) `checksum` 是「這一個版本自己那一份資源內容」的雜湊，不是整批的。**
 * 它是 `regulatory_dataset_versions` 的欄位，必須與**同一列的 `raw_data`** 對得起來——
 * 整批雜湊會讓十幾個版本共用一個值，於是「這一版的內容變了沒」這個問題再也答不出來，
 * 而那正是這一欄存在的理由。這個語意與單資源那條路**完全一致**（那裡的 checksum 也是該版本的內容），
 * 因此不是兩套規則。
 *
 * ⚠️ 代價要寫出來：多資源的既有版本**不重新下載**，因此偵測不到「政府改了某一份歷史資源的內容」。
 * 換來的是穩定狀態下一次同步只打一次 metadata API。而且就算偵測得到，處置也只能是「記一筆要人工
 * 確認的失敗」——覆寫既有版本會改寫已結算 Payroll 引用的那一版（字典明文禁止）。單資源那四個
 * 仍然照舊會偵測到（它們本來就必須下載才知道版本代碼）。
 *
 * **(3) `status_code` 只用既有的四個值，對應如下：**
 *
 * | 這一次的結果 | `status_code` | `records_received` |
 * |---|---|---|
 * | 有新建、且一個都沒失敗 | `2 更新成功` | 本次實際寫入的 records 總筆數 |
 * | **有任何一個版本失敗**（不論有沒有新建成功） | `3 失敗` | 本次實際寫入的總筆數（可能是 0） |
 * | 沒有新建、也沒有失敗（十幾個版本都已經在庫裡） | `4 無異動` | `null`（沒有下載、沒有解析） |
 *
 * 「有成功也有失敗」記成 `3` 而不是 `2`：**有東西沒進來就必須是紅的**。記成成功的話，
 * 那個永遠補不進來的版本不會有任何人發現，而它的症狀是幾個月後「補算某一期薪資時查不到版本」。
 * `error_message` 逐一列出每一個失敗的資源與原因，因此「16 個裡面壞了哪一個」看紀錄就知道；
 * `records_received` 記的是**真的寫進去的筆數**，於是「失敗了、但補進來 5 個版本」也看得出來。
 * `dataset_version_id` 指向本次建立的版本中生效日最新的那一個（一個都沒建才是 NULL）——
 * 這一欄只能指一個，而多版本同步裡最有意義的單一答案是「現行的那一版是不是這次建的」。
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
import {
  listDataGovResources,
  selectDataGovResource,
  toDataGovMetadataUrl,
  type DataGovResource,
} from '../domain/regulatory-data-gov.ts'
import {
  describeResource,
  planMultiVersionSync,
  type DatedMultiVersionPlanEntry,
} from '../domain/regulatory-multi-version-plan.ts'
import { toContentChecksum } from '../domain/regulatory-sync-checksum.ts'
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_SECONDS,
  isHeartbeatStale,
  RESOURCE_FETCH_TIMEOUT_MS,
  type ParsedRegulatoryRecord,
  type RegulatoryMultiVersionSource,
  type RegulatorySingleVersionSource,
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
  listDatasetVersionCodes,
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

/** 寫入一個版本要知道的一切（除了 `dataset_code` 與時間）。 */
type VersionWrite = {
  readonly datasetCode: SyncableDatasetCode
  readonly source: RegulatorySyncSource
  readonly resource: DataGovResource
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly checksum: string
  readonly rawText: string
  readonly records: readonly ParsedRegulatoryRecord[]
}

/**
 * 同一交易寫入 version ＋ records（計畫 §7.1、§4.4），回傳新版本的 id。
 *
 * **兩條路共用同一支**：單資源一次同步呼叫它一次，多資源呼叫它 N 次——而**每一次都是自己的交易**。
 * 十幾個版本包成一個大交易的話，第十五個解析失敗會讓前面十四個一起回捲，
 * 於是一次回補要嘛全成功要嘛全失敗，而政府那一份只要有一個年度的格式特別一點就永遠補不進來。
 *
 * 「現在」在這裡才問 clock：多資源一次同步跨十幾次下載，`synced_at` 記的是
 * **這一份資源是什麼時候取得的**，共用一個批次時間會讓那個語意不成立。
 */
const writeVersion = async (context: RegulatorySyncContext, write: VersionWrite): Promise<number> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<number> => {
    const versionId = await insertDatasetVersion(tx, {
      datasetCode: write.datasetCode,
      versionCode: write.versionCode,
      effectiveFrom: write.effectiveFrom,
      governmentResourceId: write.resource.downloadUrl,
      sourceModifiedAt: write.resource.sourceModifiedAt,
      syncedAt: now,
      checksum: write.checksum,
      recordCount: write.records.length,
      rawFormatCode: write.source.rawFormatCode,
      // 保存原始 Snapshot，不是解析結果：政府資料格式變動時，沒有它就只能重新去抓，
      // 而舊資源網址那時多半已經失效。
      rawData: write.rawText,
      createdAt: now,
    })

    await insertRegulatoryRecords(
      tx,
      write.records.map((record) => ({
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
}

/**
 * 單資源那條路：**一次同步 → 一個版本**（`dataset_code=1`、`3`、`4`、`6`）。
 *
 * 這一段與多版本上線之前**逐字相同**（只有寫入那幾行搬進了 {@link writeVersion}）：
 * 版本代碼要下載並解析之後才知道，因此「下載 → 比 checksum → 解析 → 決定版本代碼 → 寫入」
 * 是一條直線，中間沒有「這一次要不要下載」這種分支。
 */
const executeSingleVersionSync = async (
  context: RegulatorySyncContext,
  datasetCode: SyncableDatasetCode,
  source: RegulatorySingleVersionSource,
  syncLogId: number,
  metadataBody: string,
): Promise<ServiceResult<SyncOutcome>> => {
  const resource = selectDataGovResource(metadataBody, source.resourceFormat)
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
  // 資源說明要一起餵給解析器：`dataset_code=4`、`6` 的資源內容裡沒有任何日期欄位，
  // 生效日只寫在 metadata 的說明文字上（見 `domain/regulatory-sync-model.ts` 的 `RegulatoryParseContext`）。
  const parsed = source.parse(rawText, { resourceDescription: resource.value.resourceDescription })
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
  const datasetVersionId = await writeVersion(context, {
    datasetCode,
    source,
    resource: resource.value,
    versionCode,
    effectiveFrom: parsed.effectiveFrom,
    checksum,
    rawText,
    records: parsed.records,
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

/** 多版本流程裡，一個「新建」成功之後我們知道的事。 */
type CreatedVersion = {
  readonly id: number
  readonly versionCode: string
  readonly effectiveFrom: string
  readonly resourceUrl: string
  readonly recordCount: number
}

type CreateVersionOutcome =
  | { readonly ok: true; readonly value: CreatedVersion }
  | { readonly ok: false; readonly reason: string }

/**
 * 多版本流程裡的**一個**版本：下載 → 解析 → 形狀驗證 → 自己的交易寫入。
 *
 * 生效日**不由解析器回答**（它在這條路上的簽章裡沒有那一欄）：那個答案在計畫階段就已經從資源說明
 * 推導完成，而且正是「這一份要不要下載」的依據。同一個答案只有一個出處，見
 * `domain/regulatory-sync-model.ts` 的 `RegulatoryVersionRecordsParser`。
 *
 * **失敗回 `reason` 而不是拋例外**：政府某一個年度的檔案壞掉是預期中的事，處置是記下來、跑下一個。
 * 真正沒有預期的例外（資料庫斷線、唯一鍵在無人並行的情況下撞了）**照原樣往上拋**——那代表
 * 這一次同步的前提壞了，繼續跑下十幾個版本沒有意義，而 {@link runSync} 的 `catch` 會先結案再拋。
 */
const createOneVersion = async (
  context: RegulatorySyncContext,
  datasetCode: SyncableDatasetCode,
  source: RegulatoryMultiVersionSource,
  entry: DatedMultiVersionPlanEntry,
): Promise<CreateVersionOutcome> => {
  const resourceUrl = entry.resource.downloadUrl

  const downloaded = await fetchText(context, resourceUrl, '資源下載')
  if (!downloaded.ok) return { ok: false, reason: downloaded.reason }

  const rawText = downloaded.body
  const parsed = source.parse(rawText, { resourceDescription: entry.resource.resourceDescription })
  if (!parsed.ok) return { ok: false, reason: `解析失敗：${parsed.reason}` }
  if (parsed.records.length === 0) {
    return { ok: false, reason: '解析結果沒有任何 record，不寫入空版本' }
  }

  const shapeError = validateRecordShapes(datasetCode, parsed.records)
  if (shapeError !== null) return { ok: false, reason: shapeError }

  const id = await writeVersion(context, {
    datasetCode,
    source,
    resource: entry.resource,
    versionCode: entry.versionCode,
    effectiveFrom: entry.effectiveFrom,
    // checksum 是**這一個版本自己那一份內容**的雜湊，與同一列的 `raw_data` 對得起來（見檔頭 (2)）。
    checksum: toContentChecksum(rawText),
    rawText,
    records: parsed.records,
  })

  return {
    ok: true,
    value: {
      id,
      versionCode: entry.versionCode,
      effectiveFrom: entry.effectiveFrom,
      resourceUrl,
      recordCount: parsed.records.length,
    },
  }
}

/**
 * 多資源那條路：**一次同步 → 把所有還沒有的版本都補進來**（`dataset_code=2`、`5`）。
 *
 * 三個決定（幂等判定、checksum 語意、`status_code` 對應）寫在本檔檔頭，因為它們是這一段的規格。
 * 這裡只補一句迴圈本身的：**一個版本失敗不中斷其餘**，而且失敗的那一個不會動到任何已經寫進去的版本
 * ——每一個版本各自一個交易（見 {@link writeVersion}）。
 */
const executeMultiVersionSync = async (
  context: RegulatorySyncContext,
  datasetCode: SyncableDatasetCode,
  source: RegulatoryMultiVersionSource,
  syncLogId: number,
  metadataBody: string,
): Promise<ServiceResult<SyncOutcome>> => {
  const resources = listDataGovResources(metadataBody, source.resourceFormat)
  if (!resources.ok) return failSync(context, datasetCode, syncLogId, null, resources.reason)

  // 已有的版本代碼一次撈完：這一次同步期間它不會變（同一個資料集的併發寫入由心跳那把鎖擋住）。
  const existingVersionCodes = await listDatasetVersionCodes(context.db, datasetCode)
  const plan = planMultiVersionSync(resources.values, source.deriveEffectiveFrom, existingVersionCodes)

  const failures: string[] = []
  const created: CreatedVersion[] = []
  let skipped = 0

  for (const entry of plan) {
    if (entry.action === 'fail') {
      failures.push(`[${describeResource(entry.resource)}] ${entry.reason}`)
      continue
    }
    if (entry.action === 'skip') {
      skipped += 1
      continue
    }

    const outcome = await createOneVersion(context, datasetCode, source, entry)
    if (!outcome.ok) {
      failures.push(`[${describeResource(entry.resource)}] ${outcome.reason}`)
      continue
    }
    created.push(outcome.value)
  }

  // 計畫已依生效日由舊到新排序，因此最後一個成功的就是生效日最新的那一版。
  const newest = created[created.length - 1] ?? null
  const recordsWritten = created.reduce((total, version) => total + version.recordCount, 0)
  const summary =
    `共 ${String(plan.length)} 個資源：新建 ${String(created.length)} 個版本` +
    `（${String(recordsWritten)} 筆）、已存在 ${String(skipped)} 個、失敗 ${String(failures.length)} 個`

  if (failures.length > 0) {
    // **有東西沒進來就是紅的**，即使同一次也補進了幾個版本（理由見檔頭 (3)）。
    // 已經寫進去的版本留著：它們各自在自己的交易裡完成，而且「同步失敗不得破壞既有有效版本」
    // 講的是不得**動到**既有版本，不是「這一次寫的都要撤掉」——撤掉才是把好資料丟了。
    await closeSyncLog(context, syncLogId, {
      statusCode: RegulatorySyncStatus.Failed,
      datasetVersionId: newest?.id ?? null,
      governmentResourceId: newest?.resourceUrl ?? null,
      recordsReceived: recordsWritten,
      errorMessage: `${summary}。失敗明細：\n${failures.join('\n')}`,
    })
    return fail([regulatorySyncFailed(datasetCode, syncLogId, `${summary}；第一則失敗：${failures[0] ?? ''}`)])
  }

  if (newest === null) {
    // 一個都沒新建、也沒有失敗＝十幾個版本全都已經在庫裡。**這就是多版本的「無異動」**，
    // 而且它連一份資源都沒有下載——穩定狀態下一次同步只打一次 metadata API。
    const latest = await findLatestDatasetVersion(context.db, datasetCode)
    await closeSyncLog(context, syncLogId, {
      statusCode: RegulatorySyncStatus.NoChange,
      // 指向**既有的**最新版，語意與單資源那條路的無異動逐字相同。
      datasetVersionId: latest?.id ?? null,
      // 這一次沒有向任何一個資源要過內容，因此沒有「本次使用的資源」可記。
      governmentResourceId: null,
      recordsReceived: null,
      errorMessage: null,
    })
    return succeed({
      syncLogId,
      datasetCode,
      statusCode: RegulatorySyncStatus.NoChange,
      datasetVersionId: latest?.id ?? null,
      versionCode: latest?.versionCode ?? null,
      effectiveFrom: latest?.effectiveFrom ?? null,
      recordCount: null,
      governmentResourceId: null,
    })
  }

  await closeSyncLog(context, syncLogId, {
    statusCode: RegulatorySyncStatus.Succeeded,
    datasetVersionId: newest.id,
    governmentResourceId: newest.resourceUrl,
    recordsReceived: recordsWritten,
    errorMessage: null,
  })

  return succeed({
    syncLogId,
    datasetCode,
    statusCode: RegulatorySyncStatus.Succeeded,
    datasetVersionId: newest.id,
    versionCode: newest.versionCode,
    effectiveFrom: newest.effectiveFrom,
    // 本次**實際寫入**的 records 總筆數（跨十幾個版本的加總），不是最後那一版的筆數。
    recordCount: recordsWritten,
    governmentResourceId: newest.resourceUrl,
  })
}

/**
 * 同步的主體。由 {@link runSync} 在心跳啟動之後呼叫。
 *
 * 拆出來的理由是 `finally`：心跳一旦啟動就必須停掉，而把整段流程寫在 `try` 裡會讓
 * 「哪些步驟在心跳的保護範圍內」變成要靠縮排判斷的事。
 *
 * 兩條路**共用 resource discovery 這一步**（都要打同一支 metadata API），從第二步開始才分岔。
 * 分岔點寫成 `kind` 的字面值比對而不是「有沒有 `deriveEffectiveFrom`」：後者在加第三種形態時
 * 不會有任何地方變紅。
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

  return source.kind === 'single-version'
    ? executeSingleVersionSync(context, datasetCode, source, syncLogId, metadata.body)
    : executeMultiVersionSync(context, datasetCode, source, syncLogId, metadata.body)
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
