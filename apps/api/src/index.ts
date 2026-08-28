/**
 * 服務進入點：讀設定 → 建連線 → 啟動自檢 → 開始接受請求。
 *
 * 應用程式的組裝在 `app/app.ts`，那裡不連資料庫也不 listen，`bun run gen:api` 才能只載入
 * app 定義就產出契約（§1.7）。本檔是唯一會產生副作用的地方。
 */
import { buildApp } from './app/app.ts'
import { createAccessControlPorts, createRefreshControlPorts } from './app/session-access-control.ts'
import { createDatabase } from './db/client.ts'
import { assertFieldEncryptionKeys, createFieldCipher, createKeyRing } from './db/field-encryption.ts'
import { RegulatorySyncTriggerType } from './db/schema/index.ts'
import { assertDatabaseTimeZone } from './db/time-zone-guard.ts'
import { runSync, SYNCABLE_DATASET_CODES, type RegulatorySyncContext } from './modules/regulatory/index.ts'
import { startRegulatorySyncScheduler } from './scheduler/regulatory-sync-scheduler.ts'
import { systemClock } from './shared/clock.ts'
import { loadConfig } from './shared/config.ts'
import { LogCategory, logger } from './shared/logger.ts'

const config = loadConfig()
const database = createDatabase(config.database)

// 時區自檢排在 listen 之前，而且不接住例外：時區不符就是不要啟動（§6）。
// 若改成「記一筆警告然後照常啟動」，服務會活著並開始寫入偏移 8 小時的時間，
// 那正是這道檢查要防的事——讓服務起不來，遠比讓它算錯薪資便宜。
await assertDatabaseTimeZone(database)

// 金鑰自檢，理由與時區自檢相同（§5.1）：金鑰設錯時資料照樣寫得進去、讀得回來、測試全綠，
// 直到有人拿正確的金鑰來解才發現整批個資解不開。啟動就擋，是唯一能在事故**之前**攔住它的位置。
// 缺值已由 `loadConfig()` 擋下，這裡擋的是「有值但不合法」（base64 壞掉、長度不對、
// active 代號不在清單裡、索引金鑰與加密金鑰共用同一把）。
assertFieldEncryptionKeys(config.fieldEncryption)

// 金鑰環在自檢**之後**才建立：反過來的話，金鑰壞掉時炸出來的會是 `createKeyRing` 內部的
// 解碼錯誤，而 `assertFieldEncryptionKeys` 那句寫得清清楚楚的訊息永遠不會被印出來。
const cipher = createFieldCipher(createKeyRing(config.fieldEncryption))

/**
 * 身分驗證的執行相依（§1.9.0、§1.9.1）。
 *
 * `sessions` 模組的 service 需要這三樣東西才能驗票與續期；把它們收成一個具名的常數，
 * 是因為同一份東西要餵給三個地方（兩組憑證驗證器 ＋ 路由組裝點的 sessions 端點），
 * 而分開寫三次就會出現「其中一份用了不同的 clock」這種對不起來、又完全不會報錯的狀況。
 */
const sessionsContext = { db: database, clock: systemClock, session: config.session }

const app = buildApp({
  clock: systemClock,
  database,
  cipher,
  session: config.session,
  // 權限碼查詢走 `modules/company-users`、驗票與續期走 `modules/sessions`，
  // 兩者的接線都在 `app/session-access-control.ts`——入口層不直接 import 任何模組（§0.3）。
  accessControl: createAccessControlPorts(sessionsContext),
  refreshControl: createRefreshControlPorts(sessionsContext),
})

app.listen(config.port)

logger.info(LogCategory.Startup, '服務已啟動', { port: config.port, nodeEnv: config.nodeEnv })

/**
 * 計時器的正式實作。
 *
 * 心跳（`runSync` 內部）與排程器各要一個，而兩者的型別結構相同，因此只寫一份——
 * 抄兩份的話，其中一份日後改成 `unref()` 或換掉實作時另一份不會跟著改，
 * 而症狀（某一個計時器在關機後還活著）只會在關機那一刻出現。
 *
 * `void tick()`：計時器回呼不能是 async 函式的回傳值接收者，忽略掉的 Promise 由 `tick` 自己
 * 保證不會 reject（心跳與排程器內部都各自接住了例外）。
 */
const startIntervalTimer = (intervalMs: number, tick: () => Promise<void>): (() => void) => {
  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  return () => {
    clearInterval(timer)
  }
}

/**
 * 法規同步的執行相依（計畫 §7.1）。
 *
 * `fetch` 直接用標準的那一支（`FetchResource` 的簽章刻意與它相容，不需要轉接層）；
 * 逾時由 `runSync` 自己用 `AbortSignal.timeout` 帶進來，不是在這裡決定。
 */
const regulatorySyncContext: RegulatorySyncContext = {
  db: database,
  clock: systemClock,
  fetch,
  startHeartbeatTimer: startIntervalTimer,
}

/**
 * 法規同步排程器（`scheduler/regulatory-sync-scheduler.ts`）。
 *
 * **它在這裡而不是在 `app/app.ts`**：那裡是純組裝，`bun run gen:api` 只載入它就要能產出契約，
 * 因此不連資料庫也不起計時器（§1.7）。計時器是副作用，本檔是唯一產生副作用的地方。
 *
 * 預設停用，由 `REGULATORY_SYNC_SCHEDULER_ENABLED` 開啟（理由見 `shared/config.ts`）。
 */
startRegulatorySyncScheduler({
  enabled: config.regulatorySyncScheduler.enabled,
  clock: systemClock,
  // 「有解析器的資料集」那份清單的唯一來源在 `modules/regulatory`，排程器不自己維護第二份
  //（原本它有一份 `SCHEDULED_DATASETS`，理由與搬家後的保護見那兩個檔案的註解）。
  datasetCodes: SYNCABLE_DATASET_CODES,
  // 排程觸發的同步一律 `triggerTypeCode = Scheduled`：排程失敗要進告警，人工觸發失敗是操作者
  // 當場就看得到的事（見 `db/schema/regulatory-sync-logs.ts`）。分不出來的話，
  // 「昨晚的排程有沒有跑」與「誰在伺服器上手動跑了一次」在歷程上是同一件事。
  runDatasetSync: (datasetCode) =>
    runSync(regulatorySyncContext, { datasetCode, triggerTypeCode: RegulatorySyncTriggerType.Scheduled }),
  startTimer: startIntervalTimer,
  /**
   * 關機：**先把排程器停乾淨，再讓程序結束**。
   *
   * 順序不能反。`process.exit()` 會當場結束程序，正在跑的那一次同步就會留下一列停在
   * `status_code=1` 的紀錄，而它要等三分鐘後的下一次同步才會被心跳判死（計畫 §3.4）——
   * 關機是可預期的事件，沒有理由讓它走那條為「沒有預期的死亡」準備的路。
   *
   * `once` 而不是 `on`：關機途中再收到一次訊號不該再跑一次流程（`stop()` 本身也是冪等的，
   * 兩道防線是刻意的——Ctrl-C 按兩下是常見動作）。
   *
   * **只有排程器啟用時才會走到這裡**（停用時 `onShutdownSignal` 根本不會被呼叫），
   * 於是開發機的 Ctrl-C 行為與加這支排程器之前完全一樣：立刻結束，不多等任何東西。
   */
  onShutdownSignal: (stopScheduler) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      void (async () => {
        logger.info(LogCategory.Startup, '收到關機訊號，開始收尾', { signal })
        await stopScheduler()
        await app.stop()
        logger.info(LogCategory.Startup, '服務已停止', { signal })
        process.exit(0)
      })()
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  },
})
