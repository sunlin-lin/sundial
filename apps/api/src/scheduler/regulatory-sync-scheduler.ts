/**
 * 法規資料同步的排程器：**每天一次**，對「有解析器的資料集」逐一呼叫 `runSync`。
 *
 * ## 為什麼在 `src/scheduler/`，而不是 `app/` 或 `modules/regulatory/`
 *
 * - **不在 `app/app.ts`**（§1.7）：那裡是純組裝，`bun run gen:api` 要能只載入它就產出契約，
 *   因此不連資料庫、不起計時器。計時器是**副作用**，副作用只出現在 `index.ts` 那一側。
 * - **不在 `modules/regulatory/`**：§0.2 的檔名白名單裡沒有「排程器」這個位置
 *   （只有 `routes`／`handler`／`service`／`repository`／`errors`／`domain`／`impl`／`__tests__`），
 *   而這不是漏列——`regulatory-sync.service.ts` 檔頭已經寫明：「多久跑一次、由誰跑」是一個
 *   與同步的業務規則獨立的決定，把它塞進模組會讓「同步怎麼做」與「這台機器怎麼安排工作」綁在一起。
 * - **自己一層目錄而不是丟進 `shared/`**：`shared/` 是被到處 import 的工具（clock、logger、config），
 *   而排程器是一個**有生命週期的執行單元**，只有 `index.ts` 能啟動它。放進 `shared/` 會讓它看起來
 *   像是誰都可以呼叫的東西，而「誰都可以再啟動一個」正是下一段要防的事。
 *
 * ## 一個程序一個排程器；跨程序的重複**已經有人擋了**，這裡不得再發明第二套鎖
 *
 * 這一段是本檔最重要的註解，寫在這裡是為了讓下一個人在動手加「分散式鎖」之前先讀到：
 *
 * - **同一個程序內**：`index.ts` 只呼叫本檔一次，而且同一輪跑完之前不會開下一輪
 *   （見 {@link startRegulatorySyncScheduler} 裡的 `inFlight`）。這是本檔唯一負責的那把鎖。
 * - **多個程序同時跑（水平擴展）**：**不歸本檔管，而且刻意不管。** `runSync` 的第一步就是
 *   「判死心跳逾時的舊紀錄 → 還有活著的就回 `already-running`」（計畫 §3.4）——
 *   兩台機器在同一秒醒來時，第二台會拿到 `regulatory.sync.errors.already-running` 而不做事。
 *   那道門是**用資料庫那一列 `status_code=1` 當鎖**，因此它擋得住的範圍與程序數量無關。
 *
 *   在這裡再加一把鎖（Redis、advisory lock、選主）會有兩個後果：其一，本檔要自己維護鎖的
 *   逾時與釋放，而那正是心跳已經解過一次的問題（固定逾時猜大猜小的兩難，計畫 §3.4 有完整論述）；
 *   其二，兩套鎖的存活判定會分岔——外層鎖認為程序還活著、心跳認為已經死了（或反過來），
 *   而分岔的那一刻沒有任何測試會紅，症狀是「某個資料集再也不同步」或「兩個程序同時寫同一版」。
 *
 *   **本檔要做的是不要繞過那道門**：每個資料集照樣呼叫 `runSync`，拿到 `already-running` 就記一行
 *   走下一個，不重試、不等待、不比較誰先醒來。
 *
 * ## 頻率：每天台北 03:00 一次（{@link DAILY_SYNC_MINUTE_OF_DAY}）
 *
 * - **為什麼是一天一次而不是一小時一次**：這幾份資料一年改一到兩次（計畫 §7.0），
 *   而 checksum 相同時同步會以 `status=4 無異動` 結束、成本只有一次 metadata ＋ 一次下載。
 *   一小時一次會讓政府端點一年被打八千多次去換兩次真正的變更，那不是禮貌的用法；
 *   一週一次則讓「法規改了」到「我們發現」之間最長差七天，而那七天裡結算的薪資是用舊版算的。
 *   一天一次讓最差情況是一天，成本一年三百多次。
 * - **為什麼是固定時刻而不是「每隔 24 小時」**：後者的實際時刻由「上一次部署在幾點」決定，
 *   於是它會慢慢漂到上班時間，而且每次部署都重新漂一次。固定牆鐘時刻讓同步永遠落在離峰，
 *   也讓「昨天有沒有跑」是一個可以用日期回答的問題（見 `lastRunDate`）。
 * - **時刻一律台北牆鐘**（§6）：本檔一次都沒有 `new Date()`，「今天是幾號、現在是第幾分鐘」
 *   全部問注入的 clock（`today()`／`minuteOfDay()` 回傳的就是台北時間）。伺服器多半跑在 UTC，
 *   用 `getHours()` 判定的話台北 03:00 會變成前一天 19:00。
 *
 * ## 關機（`SIGINT`／`SIGTERM`）
 *
 * 心跳是為了**沒有預期的**死亡（OOM、機器重啟）而存在，代價是那一列要卡三分鐘才會被判死。
 * 關機是可預期的，因此可以做得更好：停掉計時器、**不再開始新的資料集**、
 * 但**等進行中的那一個資料集把 `runSync` 跑完**——`runSync` 自己會把那一列結案
 * （成功、無異動或失敗，見它的 `try/catch/finally`），於是關機不會留下任何停在「執行中」的紀錄。
 *
 * 訊號的註冊由呼叫端提供（{@link RegulatorySyncSchedulerDependencies.onShutdownSignal}），
 * 本檔不碰 `process`：程序要不要因此結束、HTTP 伺服器要不要一起收掉，是入口的決定，不是排程器的。
 * 寫成**必填**相依而不是「呼叫端記得自己接」，是因為忘了接的症狀是「部署時同步被砍在半路」，
 * 那筆紀錄要等三分鐘後的下一次同步才會被判死——而現在它是一個編譯錯誤。
 */
import {
  isSyncableDatasetCode,
  RegulatorySyncErrorCode,
  type SyncableDatasetCode,
  type SyncOutcome,
} from '../modules/regulatory/index.ts'
import type { Clock } from '../shared/clock.ts'
import { LogCategory, logger } from '../shared/logger.ts'
import type { DomainError, ServiceResult } from '../shared/service-result.ts'

/**
 * 排程器醒來看一次牆鐘的間隔：60 秒。
 *
 * 這**不是**同步的頻率（那是下面的每日時刻），只是「多久檢查一次現在到了沒」。
 * 60 秒代表實際觸發時刻與 03:00 最多差一分鐘，對一天一次的工作而言足夠精確，
 * 而且它讓一個「啟動後 60 秒內就崩潰重啟」的程序**完全不會**觸發同步——
 * 計時器第一次擊發是在 60 秒後，不是啟動當下。
 */
export const SCHEDULER_TICK_INTERVAL_MS = 60_000

/**
 * 每日同步時刻：台北 03:00（當日第 180 分鐘）。
 *
 * 選離峰不是禮貌問題而已：政府端點白天回應緩慢是本模組的常態情境（計畫 §3.4 拿它當「長步驟」
 * 的例子），而慢到超過三個心跳週期就會讓活著的程序被判死。凌晨同時也讓「今天的同步結果」
 * 在上班前就已經確定，看 `regulatory_sync_logs` 的人不必猜「現在是不是還在跑」。
 */
export const DAILY_SYNC_MINUTE_OF_DAY = 3 * 60

/**
 * 排程要掃的資料集：**每一個有解析器的資料集都必須在這裡出現一次**。
 *
 * `satisfies Record<SyncableDatasetCode, true>` 是這一行的重點：日後有人在
 * `sync/domain/regulatory-sync-source.ts` 加上第二個解析器時，這一行**當場編譯不過**。
 * 寫成 `[1]` 這種陣列的話，聯集變大不會讓任何地方變紅——新資料集會安靜地永遠不被同步，
 * 而症狀（「那個資料集怎麼沒有版本」）要幾個月後才有人問。
 *
 * 值是 `true` 而不是別的東西：這裡要表達的只有「有沒有列到」，任何額外欄位都會變成
 * 「排程器自己也有一份資料集設定」，而那份設定與 `REGULATORY_SYNC_SOURCES` 必然分岔。
 */
const SCHEDULED_DATASETS = { 1: true, 3: true, 4: true, 6: true } as const satisfies Record<SyncableDatasetCode, true>

/**
 * {@link SCHEDULED_DATASETS} 的代碼清單。
 *
 * 用 `isSyncableDatasetCode`（`sync/domain` 匯出的執行期收斂）過濾而不是 `as` 斷言：
 * `Object.keys` 回的是 `string[]`，型別斷言會讓「key 寫錯一個數字」變成執行期才發現的事，
 * 而那個判定函式存在的理由正是這一條路（見該檔對它的說明）。
 */
export const SCHEDULED_DATASET_CODES: readonly SyncableDatasetCode[] = Object.keys(SCHEDULED_DATASETS)
  .map(Number)
  .filter(isSyncableDatasetCode)

/**
 * 對一個資料集跑一次同步。
 *
 * 型別上就是 `runSync` 綁好 context 與 `triggerTypeCode` 之後的樣子（接線在 `index.ts`）。
 * **本檔刻意拿不到 `RegulatorySyncContext`**：排程器不需要資料庫連線、不需要 `fetch`，
 * 給了它就等於讓「什麼時候跑」這一層有能力去改「怎麼跑」。
 */
export type RunDatasetSync = (datasetCode: SyncableDatasetCode) => Promise<ServiceResult<SyncOutcome>>

/** 一次醒來。回傳 `Promise` 讓測試能 `await` 一整輪，不必等真實時間過去。 */
export type SchedulerTick = () => Promise<void>

/** 停止計時器。可重複呼叫。 */
export type StopSchedulerTimer = () => void

/**
 * 啟動計時器：每 `intervalMs` 毫秒呼叫一次 `tick`，回傳停止函式。
 *
 * 注入而不是直接 `setInterval`，理由與 `sync` 那一側的心跳計時器完全相同：測試要能**手動擊發**，
 * 否則「排程器到點會跑」這件事只能靠睡覺來測，而那種測試在 CI 上會偶爾紅、然後被改成睡更久。
 */
export type StartSchedulerTimer = (intervalMs: number, tick: SchedulerTick) => StopSchedulerTimer

/**
 * 把「關機時要停排程器」這件事交給呼叫端註冊（production：`process.once('SIGINT'|'SIGTERM', …)`）。
 *
 * 參數是排程器的 `stop`，而 `stop` 回傳的 Promise 在**進行中的那個資料集跑完之後**才 resolve。
 * 呼叫端必須 await 它再讓程序結束，否則就退化成「被砍在半路」，而那正是心跳要花三分鐘才收拾得了的事。
 */
export type RegisterShutdownSignal = (stopScheduler: () => Promise<void>) => void

export type RegulatorySyncSchedulerDependencies = {
  /**
   * 要不要啟用。`false` 時本檔**什麼都不做**：不起計時器、不註冊訊號、一次同步都不跑。
   *
   * 由環境變數決定（`shared/config.ts` 的 `REGULATORY_SYNC_SCHEDULER_ENABLED`），
   * 預設值與理由寫在那裡。判斷放在本檔而不是 `index.ts` 的 `if`：停用是排程器的一種狀態
   * （它要為此留一行啟動 log），而寫成 `if` 之後「停用時到底發生了什麼」就沒有測試蓋得到。
   */
  readonly enabled: boolean
  /** 「今天是幾號、現在是第幾分鐘」的唯一來源（§6.2）。台北牆鐘。 */
  readonly clock: Clock
  /** 這一輪要掃哪些資料集。production 傳 {@link SCHEDULED_DATASET_CODES}。 */
  readonly datasetCodes: readonly SyncableDatasetCode[]
  readonly runDatasetSync: RunDatasetSync
  readonly startTimer: StartSchedulerTimer
  readonly onShutdownSignal: RegisterShutdownSignal
}

/**
 * 這一輪該不該開始。
 *
 * 判準只有兩條，而且都只看牆鐘與「上一次跑的是哪一天」：
 * 1. 今天還沒跑過（`lastRunDate !== today`）——一天一次，重複醒來不重複跑；
 * 2. 已經過了每日時刻。
 *
 * **程序啟動時 `lastRunDate` 是 `null`，因此在 03:00 之後啟動的程序會在第一次 tick 就補跑一輪。**
 * 這是刻意的：部署多半發生在白天，補跑讓「解析器壞了／政府改格式了」在部署當天就留下
 * `status_code=3`，而不是等到隔天凌晨才第一次被發現。代價是每次部署多一次同步，
 * 而 checksum 沒變時那一次以 `status=4 無異動` 結束，成本是一次 metadata ＋ 一次下載。
 */
const shouldStartRound = (today: string, minuteOfDay: number, lastRunDate: string | null): boolean =>
  lastRunDate !== today && minuteOfDay >= DAILY_SYNC_MINUTE_OF_DAY

/**
 * 記一行「這個資料集這次沒跑成」。
 *
 * **不寫 `regulatory_sync_logs`**：失敗已經由 `runSync` 寫進去了（`status_code=3` ＋ `error_message`），
 * 排程器再寫一次會讓同一次失敗在歷程上出現兩列，而其中一列沒有 `started_at` 之外的任何內容。
 * 這一行的用途是**告警**——看 log 的人不必先去查資料庫才知道昨晚壞了。
 *
 * `already-running` 走 `warn` 而其餘走 `error`，因為兩者的處置完全不同：前者是水平擴展下的正常結果
 *（另一個程序正在跑同一個資料集，見檔頭），後者要有人去看 `error_message`。
 * 混成同一級之後，「每天都有幾筆 warn」會讓真正的失敗被當成背景雜訊。
 */
const logFailedDataset = (datasetCode: SyncableDatasetCode, errors: readonly DomainError[]): void => {
  const fields = {
    datasetCode,
    // 只帶 `code` 與 `data`（`data` 裡有 `syncLogId` 與失敗原因摘要，見 `regulatory-sync.errors.ts`）。
    // `msg`／`params` 是給出口層翻譯用的，進 log 只是雜訊。
    errors: errors.map((error) => ({ code: error.code, data: error.data })),
  }

  const onlyAlreadyRunning = errors.every((error) => error.code === RegulatorySyncErrorCode.AlreadyRunning)
  if (onlyAlreadyRunning) {
    logger.warn(LogCategory.UnhandledException, '法規同步略過：同一個資料集已有活著的同步在跑', fields)
    return
  }

  logger.error(LogCategory.UnhandledException, '法規同步失敗', fields)
}

/**
 * 啟動排程器。**整個程序只呼叫一次，呼叫者是 `index.ts`**（唯一的副作用位置）。
 *
 * 回傳 `void` 是刻意的：`stop` 只透過 {@link RegisterShutdownSignal} 交出去，
 * 於是「停止排程器」在程式碼裡只有關機那一條路徑，不會有第二個地方拿著它在別的時機呼叫。
 */
export const startRegulatorySyncScheduler = (dependencies: RegulatorySyncSchedulerDependencies): void => {
  const { clock, datasetCodes, runDatasetSync, startTimer, onShutdownSignal } = dependencies

  if (!dependencies.enabled) {
    // 停用時**也要留一行 log**。預設是停用（見 `shared/config.ts`），因此「正式環境忘了設環境變數」
    // 的症狀就是「再也沒有新版本」——一個完全沒有症狀的故障。這一行讓它在啟動的第一秒就看得見。
    logger.info(LogCategory.Startup, '法規同步排程器已停用（REGULATORY_SYNC_SCHEDULER_ENABLED 未啟用）')
    return
  }

  /** 上一輪開始的日期（台北日曆日）。`null` 代表本程序還沒跑過任何一輪。 */
  let lastRunDate: string | null = null
  /** 進行中的那一輪。**同一個程序只跑一輪**，它同時是「跳過這次 tick」與「關機要等誰」的依據。 */
  let inFlight: Promise<void> | null = null
  /** 收到關機訊號之後為 `true`：不再開始新的資料集，也不再開始新的一輪。 */
  let stopping = false

  const runRound = async (): Promise<void> => {
    for (const datasetCode of datasetCodes) {
      // 關機時**在資料集之間停下**，不是在某個資料集的中途停下：後者會留下一筆停在「執行中」的紀錄，
      // 而那是心跳要花三分鐘才收拾得了的事（計畫 §3.4）。
      if (stopping) {
        logger.info(LogCategory.Startup, '排程器關機中，略過本輪剩餘的資料集', { skippedFrom: datasetCode })
        return
      }

      try {
        const result = await runDatasetSync(datasetCode)
        if (!result.ok) logFailedDataset(datasetCode, result.errors)
      } catch (error) {
        // **這個 `catch` 是本檔的承重牆。** 少了它，第一個丟例外的資料集會讓整輪停掉，
        // 而其餘資料集這一天完全不會被同步——沒有失敗紀錄（`runSync` 只為它自己那一列寫紀錄）、
        // 沒有任何跡象，看起來就像「今天沒到時間」。
        //
        // 這不算吞掉例外（§3.3）：例外的成因已經由 `runSync` 寫進那一列的 `error_message`
        //（它在往上拋之前先結案），這裡再記一行帶堆疊的 error log 進告警，然後**繼續跑下一個資料集**。
        logger.error(LogCategory.UnhandledException, '法規同步丟出未預期的例外，其餘資料集繼續', {
          datasetCode,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
      }
    }
  }

  const tick: SchedulerTick = async () => {
    if (stopping) return

    if (inFlight !== null) {
      // 上一輪還沒跑完（政府端點慢、或資料集變多）。**跳過，不排隊、不平行跑**：
      // 平行跑的話兩輪會對同一個資料集同時呼叫 `runSync`，於是第二輪整批拿到 `already-running`
      // ——log 上看起來像「有另一台機器在跑」，實際上是自己絆自己，而且查不出來。
      logger.warn(LogCategory.UnhandledException, '上一輪法規同步尚未結束，略過這次排程')
      return
    }

    const today = clock.today()
    if (!shouldStartRound(today, clock.minuteOfDay(), lastRunDate)) return

    // 先記日期再跑：跑完才記的話，一輪跑超過一分鐘就會被下一次 tick 當成「今天還沒跑」
    //（`inFlight` 擋得住同時跑，擋不住它跑完之後緊接著再跑一輪）。
    lastRunDate = today

    logger.info(LogCategory.Startup, '法規同步排程開始', { datasetCount: datasetCodes.length, date: today })
    const round = runRound()
    inFlight = round
    try {
      await round
    } finally {
      inFlight = null
    }
    logger.info(LogCategory.Startup, '法規同步排程結束', { date: today })
  }

  const stopTimer = startTimer(SCHEDULER_TICK_INTERVAL_MS, tick)

  /** 關機用的停止流程。**必須可以重複呼叫**：`SIGINT` 之後再來一個 `SIGTERM` 是常見的。 */
  let stopped: Promise<void> | null = null
  const stop = (): Promise<void> => {
    if (stopped !== null) return stopped

    stopping = true
    stopTimer()

    stopped = (async () => {
      if (inFlight !== null) {
        logger.info(LogCategory.Startup, '排程器停止中，等待進行中的同步結束')
        // `runRound` 每個資料集都自帶 `try/catch`，因此這裡 await 到的一定是正常結束；
        // 不加 `catch` 是刻意的——真的有例外從這裡冒出來代表 `runRound` 的保護破了，
        // 那是要進告警的事，不是關機流程該吞掉的事。
        await inFlight
      }
      logger.info(LogCategory.Startup, '法規同步排程器已停止')
    })()

    return stopped
  }

  onShutdownSignal(stop)

  logger.info(LogCategory.Startup, '法規同步排程器已啟動', {
    datasetCodes,
    tickIntervalMs: SCHEDULER_TICK_INTERVAL_MS,
    dailySyncMinuteOfDay: DAILY_SYNC_MINUTE_OF_DAY,
  })
}
