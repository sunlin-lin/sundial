/**
 * 排程器的測試。**一條都不等真實時間過去。**
 *
 * ## 被替換掉的是時間與 `runSync`，不是被測邏輯本身（§7.3）
 *
 * 排程器的業務內容只有三件事：**什麼時候開始一輪**、**一輪裡面怎麼掃資料集**、**關機時怎麼收尾**。
 * 這三件事全部跑真的那一份。替換掉的兩樣都是注入的函式型別，不是被攔截的模組：
 *
 * - **clock**：`clockFrom` 讓「現在」由本檔控制（§6.2）。台北 03:00 的判定靠它，不靠 `sleep`。
 * - **計時器**：測試把 `tick` 收起來手動擊發。真的用 `setInterval` 的話，「到點會跑」這條測試
 *   要睡一分鐘才測得到，而那種測試最後一定會被刪掉。
 * - **`runSync`**：排程器要驗的是「有沒有對每個資料集各呼叫一次、其中一個炸了會怎樣」，
 *   真的那一支要資料庫與政府端點（它自己的整合測試在 `modules/regulatory/sync/__tests__/`）。
 *
 * ## 時間一律用台北牆鐘讀，測試裡的 UTC 是為了讓那件事被驗到
 *
 * 下面的 `instant` 寫成 UTC（`…T19:30:00Z`），對應台北 03:30。若哪天有人把排程器改成讀
 * 系統時區或 `getHours()`，這幾條測試會在 UTC 機器上直接紅——寫成台北時間的字串就驗不到這件事。
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { RegulatorySyncStatus } from '../../db/schema/index.ts'
import {
  regulatorySyncAlreadyRunning,
  regulatorySyncFailed,
  SYNCABLE_DATASET_CODES,
  type SyncableDatasetCode,
  type SyncOutcome,
} from '../../modules/regulatory/index.ts'
import { clockFrom } from '../../shared/clock.ts'
import { fail, succeed, type ServiceResult } from '../../shared/service-result.ts'
import {
  SCHEDULER_TICK_INTERVAL_MS,
  startRegulatorySyncScheduler,
  type RunDatasetSync,
  type SchedulerTick,
} from '../regulatory-sync-scheduler.ts'

/** 台北 2026-08-28 02:00（還沒到每日時刻）。 */
const BEFORE_DAILY_TIME = new Date('2026-08-27T18:00:00.000Z')
/** 台北 2026-08-28 03:30（已過每日時刻）。 */
const AFTER_DAILY_TIME = new Date('2026-08-27T19:30:00.000Z')
/** 台北 2026-08-29 03:30（隔天）。 */
const NEXT_DAY = new Date('2026-08-28T19:30:00.000Z')

let instant = AFTER_DAILY_TIME
const clock = clockFrom(() => instant)

/**
 * 同步成功的回傳值。內容不重要——排程器只看 `ok`，不看 `value` 的任何一欄
 *（值的正確性是 `runSync` 自己的測試在驗的事）。
 */
const outcome = (datasetCode: SyncableDatasetCode): SyncOutcome => ({
  syncLogId: 1,
  datasetCode,
  statusCode: RegulatorySyncStatus.NoChange,
  datasetVersionId: 1,
  versionCode: '2026-01',
  effectiveFrom: '2026-01-01',
  recordCount: null,
  governmentResourceId: 'https://example.invalid/resource',
})

type HarnessOptions = {
  readonly enabled?: boolean
  readonly datasetCodes?: readonly SyncableDatasetCode[]
  /** 第 `callIndex` 次呼叫（1 起算）要做什麼；預設一律成功。 */
  readonly onRun?: (datasetCode: SyncableDatasetCode, callIndex: number) => Promise<ServiceResult<SyncOutcome>>
}

type Harness = {
  /** 每一次 `runDatasetSync` 收到的資料集代碼，依呼叫順序。 */
  readonly calls: SyncableDatasetCode[]
  /** 真的跑完（不是只有被呼叫）的那些。關機測試靠它分辨「跑完」與「被砍在半路」。 */
  readonly completed: SyncableDatasetCode[]
  /** 計時器要求的週期；沒啟動時是 `null`。 */
  tickIntervalMs(): number | null
  /** 計時器被停掉幾次。 */
  timerStops(): number
  /** 排程器有沒有把 `stop` 交出去（＝有沒有註冊關機處理）。 */
  shutdownRegistered(): boolean
  /** 手動擊發一次計時器，並等這一輪跑完。 */
  fireTick(): Promise<void>
  /** 手動擊發但**不等它跑完**（用來製造「一輪進行到一半」）。 */
  fireTickWithoutWaiting(): Promise<void>
  /** 模擬關機訊號：呼叫排程器交出來的 `stop`。 */
  sendShutdownSignal(): Promise<void>
}

const startHarness = (options: HarnessOptions = {}): Harness => {
  const calls: SyncableDatasetCode[] = []
  const completed: SyncableDatasetCode[] = []
  let capturedTick: SchedulerTick | null = null
  let capturedStop: (() => Promise<void>) | null = null
  let intervalMs: number | null = null
  let stops = 0

  const runDatasetSync: RunDatasetSync = async (datasetCode) => {
    calls.push(datasetCode)
    const result = (await options.onRun?.(datasetCode, calls.length)) ?? succeed(outcome(datasetCode))
    completed.push(datasetCode)
    return result
  }

  startRegulatorySyncScheduler({
    enabled: options.enabled ?? true,
    clock,
    datasetCodes: options.datasetCodes ?? SYNCABLE_DATASET_CODES,
    runDatasetSync,
    startTimer: (requestedIntervalMs, tick) => {
      intervalMs = requestedIntervalMs
      capturedTick = tick
      return () => {
        stops += 1
      }
    },
    onShutdownSignal: (stop) => {
      capturedStop = stop
    },
  })

  const requireTick = (): SchedulerTick => {
    if (capturedTick === null) throw new Error('排程器沒有啟動計時器')
    return capturedTick
  }

  return {
    calls,
    completed,
    tickIntervalMs: () => intervalMs,
    timerStops: () => stops,
    shutdownRegistered: () => capturedStop !== null,
    fireTick: async () => {
      await requireTick()()
    },
    // 不 await：呼叫到第一個資料集的 `await` 為止是同步執行的，因此回來時「一輪正在跑」已經成立。
    fireTickWithoutWaiting: () => requireTick()(),
    sendShutdownSignal: async () => {
      if (capturedStop === null) throw new Error('排程器沒有註冊關機處理')
      await capturedStop()
    },
  }
}

/** 手動控制的 Promise：讓一次同步停在半路，直到測試放行。 */
const deferred = (): { readonly promise: Promise<void>; release: () => void } => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

beforeEach(() => {
  instant = AFTER_DAILY_TIME
})

describe('排程的觸發時機', () => {
  test('每日時刻之前不跑，之後跑一輪，而且同一天只跑一次', async () => {
    instant = BEFORE_DAILY_TIME
    const harness = startHarness()

    // 台北 02:00：醒來了，但還沒到 03:00。
    await harness.fireTick()
    expect(harness.calls).toEqual([])

    instant = AFTER_DAILY_TIME
    await harness.fireTick()
    expect(harness.calls).toEqual([...SYNCABLE_DATASET_CODES])

    // 同一天再醒來幾次都不該再跑：一天一次是排程的定義，不是巧合。
    await harness.fireTick()
    await harness.fireTick()
    expect(harness.calls).toEqual([...SYNCABLE_DATASET_CODES])

    // 換一天就再跑一輪。
    instant = NEXT_DAY
    await harness.fireTick()
    expect(harness.calls).toEqual([...SYNCABLE_DATASET_CODES, ...SYNCABLE_DATASET_CODES])
  })

  test('一輪會對每一個有解析器的資料集各呼叫一次', async () => {
    const harness = startHarness()

    await harness.fireTick()

    // 逐一比對而不是只比數量：漏掉一個資料集與多跑一次同一個資料集，數量上可能一樣。
    expect(harness.calls).toEqual([...SYNCABLE_DATASET_CODES])
    expect(new Set(harness.calls).size).toBe(SYNCABLE_DATASET_CODES.length)
  })

  test('計時器的週期是 60 秒，而且啟動當下不跑（第一次擊發在一分鐘後）', () => {
    const harness = startHarness()

    expect(harness.tickIntervalMs()).toBe(SCHEDULER_TICK_INTERVAL_MS)
    // 啟動就跑的話，一個每 10 秒崩潰重啟一次的程序會每 10 秒打一次政府端點。
    expect(harness.calls).toEqual([])
  })

  test('上一輪還沒跑完時，這次擊發直接跳過（不平行跑、不排隊）', async () => {
    const gate = deferred()
    const harness = startHarness({
      datasetCodes: [1, 1],
      onRun: async (datasetCode, callIndex) => {
        if (callIndex === 1) await gate.promise
        return succeed(outcome(datasetCode))
      },
    })

    const round = harness.fireTickWithoutWaiting()
    expect(harness.calls).toHaveLength(1)

    // 第二次擊發：上一輪卡在第一個資料集，這次應該原地返回，不得再開一輪。
    instant = NEXT_DAY
    await harness.fireTick()
    expect(harness.calls).toHaveLength(1)

    gate.release()
    await round
    expect(harness.calls).toHaveLength(2)
  })
})

describe('一個資料集失敗不得中斷其餘', () => {
  /**
   * 清單裡刻意出現同一個代碼三次。
   *
   * 目前只有 `dataset_code = 1` 有解析器（`SyncableDatasetCode` 就是這個單一值的聯集），
   * 而本節要驗的是**迴圈的隔離性**，與是哪幾個資料集無關。等另外兩支解析器上線、聯集變大之後，
   * 這裡可以改成三個不同的代碼，斷言一字不用改。
   */
  const THREE_DATASETS: readonly SyncableDatasetCode[] = [1, 1, 1]

  test('其中一個丟例外，其餘仍然會被呼叫', async () => {
    const harness = startHarness({
      datasetCodes: THREE_DATASETS,
      onRun: (datasetCode, callIndex) => {
        // 未預期的例外（資料庫斷線、模組的 bug）。`runSync` 會先把那一列結案再往上拋。
        if (callIndex === 2) throw new Error('資料庫連線中斷')
        return Promise.resolve(succeed(outcome(datasetCode)))
      },
    })

    await harness.fireTick()

    // 少了排程器裡那個 per-dataset 的 `catch`，這裡會是 2（第二個炸掉，第三個永遠不會被呼叫），
    // 而第三個資料集這一天不會有任何紀錄——連一筆失敗都沒有。
    expect(harness.calls).toHaveLength(3)
  })

  test('例外不會讓排程器死掉，隔天照樣跑', async () => {
    const harness = startHarness({
      datasetCodes: THREE_DATASETS,
      onRun: (datasetCode, callIndex) => {
        if (callIndex <= 3) throw new Error('政府端點整批壞掉')
        return Promise.resolve(succeed(outcome(datasetCode)))
      },
    })

    await harness.fireTick()
    expect(harness.calls).toHaveLength(3)

    instant = NEXT_DAY
    await harness.fireTick()
    expect(harness.calls).toHaveLength(6)
  })

  test('回業務失敗（`ServiceResult` 的失敗分支）時，其餘也照樣被呼叫', async () => {
    const harness = startHarness({
      datasetCodes: THREE_DATASETS,
      onRun: (datasetCode, callIndex) => {
        // 第一個：同步失敗（`status_code=3` 已由 `runSync` 寫進 sync_log）。
        if (callIndex === 1) return Promise.resolve(fail([regulatorySyncFailed(datasetCode, 42, '解析失敗')]))
        // 第二個：另一個程序（水平擴展）正在跑同一個資料集。**這一條不是錯誤，是設計**：
        // 跨程序的重複由 `runSync` 的心跳擋，排程器只記一行 warn 就走下一個，不重試、不等待。
        if (callIndex === 2) return Promise.resolve(fail([regulatorySyncAlreadyRunning(datasetCode, 7)]))
        return Promise.resolve(succeed(outcome(datasetCode)))
      },
    })

    await harness.fireTick()

    expect(harness.calls).toHaveLength(3)
  })
})

describe('停用', () => {
  test('停用時完全不啟動：沒有計時器、沒有關機處理、一次同步都不跑', async () => {
    const harness = startHarness({ enabled: false })

    expect(harness.tickIntervalMs()).toBeNull()
    expect(harness.shutdownRegistered()).toBe(false)
    expect(harness.calls).toEqual([])

    // 連擊發的入口都不存在——停用不是「跑了但什麼都不做」，是根本沒有計時器。
    await expect(harness.fireTick()).rejects.toThrow('排程器沒有啟動計時器')
  })
})

describe('關機訊號', () => {
  test('停掉計時器、等進行中的同步跑完、不再開始其餘資料集', async () => {
    const gate = deferred()
    const harness = startHarness({
      datasetCodes: [1, 1, 1],
      onRun: async (datasetCode, callIndex) => {
        if (callIndex === 1) await gate.promise
        return succeed(outcome(datasetCode))
      },
    })

    const round = harness.fireTickWithoutWaiting()
    expect(harness.calls).toHaveLength(1)
    expect(harness.completed).toEqual([])

    const shutdown = harness.sendShutdownSignal()

    // 計時器當場停掉：關機途中不該再有新的一輪醒來。
    expect(harness.timerStops()).toBe(1)

    // 進行中的那一個還沒跑完，關機流程必須還在等它——不能在這一刻就結束程序，
    // 否則那一列會停在 `status_code=1`，要等三分鐘後的下一次同步才被心跳判死（計畫 §3.4）。
    expect(harness.completed).toEqual([])

    gate.release()
    await shutdown
    await round

    // 進行中的那一個**跑完了**，而它後面的兩個**沒有被開始**。
    expect(harness.completed).toEqual([1])
    expect(harness.calls).toHaveLength(1)
  })

  test('關機之後計時器再被擊發也不會再跑（而且 stop 可以重複呼叫）', async () => {
    const harness = startHarness({ datasetCodes: [1, 1] })

    await harness.sendShutdownSignal()
    // Ctrl-C 按兩下、或 SIGINT 之後再來一個 SIGTERM：不得重跑收尾流程。
    await harness.sendShutdownSignal()
    expect(harness.timerStops()).toBe(1)

    // 真實的計時器已經停了，但擊發一次來證明排程器自己也擋（兩道防線是刻意的）。
    await harness.fireTick()
    expect(harness.calls).toEqual([])
  })
})
