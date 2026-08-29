# 時間與時區

本篇對應 `docs/dev-standards-backend.md` §6（行 1273–1320）與 §0.6.4（`scheduler/` 為什麼是獨立
一層，行 197–210）。全系統只用一個時區：**台北時間（`Asia/Taipei`, UTC+8）**，資料庫、後端、
API 傳輸、前端看到的是同一組牆鐘數字，不做任何時區換算。「現在」永遠由呼叫端注入的
`shared/clock.ts` 提供，業務程式碼與 ESLint 都禁止直接 `new Date()`／`Date.now()`。排程器
（`scheduler/`）是時間觸發、有生命週期、一個程序只准一份的背景執行單元，只能由 `index.ts` 啟動。

## 1. API 傳輸格式：兩種時間字串

判準只有一句：**這個時間會不會出現在畫面上？** 會 → 業務時間格式；只給機器看 → 傳輸層時戳格式
（§6.1）。同一個 payload 裡兩種格式會同時出現，不得混用。

| 類型                              | 格式                                      | 範例                        | 共用型別（`shared/field-schemas.ts`） |
| --------------------------------- | ----------------------------------------- | --------------------------- | ------------------------------------- |
| 業務日期時間 `datetime`           | `YYYY-MM-DD HH:mm:ss`，不帶時區標記       | `2026-08-26 09:30:00`       | `TaipeiDateTime`                      |
| 業務日期 `date`                   | `YYYY-MM-DD`                              | `2026-08-26`                | `IsoDate`                             |
| 月份                              | `YYYY-MM`                                 | `2026-08`                   | `YearMonth`                           |
| 不含日期的時刻                    | `HH:mm`；跨午夜以「當日第幾分鐘」整數表示 | `09:00` 或 `1560`           | 各模組自訂（見 §3.4）                 |
| 傳輸層時戳 `rqTS`／`rspTS`／`exp` | ISO 8601 **帶時區偏移**                   | `2026-04-14T14:30:00+08:00` | `TransportTS`                         |

三個共用型別（`apps/api/src/shared/field-schemas.ts`）：

```ts
export const IsoDate = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
export const TaipeiDateTime = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' })
export const TransportTS = t.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?[+-]\\d{2}:\\d{2}$',
})
```

`TransportTS` 只出現在 `shared/envelope.ts` 的 `BaseRequest.rqTS` 與回應信封的 `rspTS`／`exp`。

- **業務時間欄位一律引用 `TaipeiDateTime`／`IsoDate`／`YearMonth`，禁止就地重寫 `t.String()` 或用
  `toISOString()` 產出。** 三個共用型別與 `TransportTS` **不可互相代入**，「拿 `rqTS` 當業務時間
  用」在型別上就寫不出來。
- **`rqTS`／`rspTS`／`exp` 是唯三允許帶時區偏移的欄位，且只供 log 與除錯，一律不上畫面**；`exp`
  另外禁止用於過期判斷，前端顯示剩餘時間一律由 `expiresIn`（相對秒數）倒數推導。
- 前端規範 §9.2／§3.7 與上表逐字一致，兩邊改動必須同步；`apps/api/scripts/check-tz-leak.ts` 在
  前端側落地：`exp` 不得出現在顯示路徑、業務時間字面值不得帶 `+08:00`／`Z`／`T`、`shared/format/`
  以外禁止 `new Date(`／`Date.now(`。

```ts
// ✅ 正確：業務時間欄位引用共用型別
const RequestBody = t.Object({ hireDate: IsoDate, effectiveFrom: IsoDate })

// ❌ 錯誤：就地重寫、且帶了時區標記
const RequestBody = t.Object({ hireDate: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T.*Z$' }) })
```

---

## 2. 資料庫時間欄位與時區自檢

- **連線 session 時區固定 `+08:00`**；`datetime` 存台北牆鐘時間、`date` 存台北的日曆日，兩者都
  不做換算。理由（§6）：全程台北時間讓「時刻」「歸屬日期」「時段分鐘數」三者天然一致，把「換算」
  這個動作整個從流程中移除，也就沒有漏換算的可能。
- schema 一律宣告 `{ mode: 'string' }`，讓 drizzle 回傳原始字串而不是替你轉成 `Date` 物件
  （`apps/api/src/db/schema/employee-employments.ts`）：

```ts
hireDate: date('hire_date', { mode: 'string' }).notNull(),
createdAt: datetime('created_at', { mode: 'string' }).notNull(),
```

- **應用程式啟動時比對資料庫時區，不一致就拒絕啟動**（`apps/api/src/db/time-zone-guard.ts` 的
  `assertDatabaseTimeZone`）。查 `SELECT @@session.time_zone`，讀不到、或不等於 `+08:00`（含
  MariaDB 回傳 `SYSTEM`，代表沿用伺服器時區，同樣不接受）就丟例外中止程序：

```ts
export const EXPECTED_SESSION_TIME_ZONE = '+08:00'

export const assertDatabaseTimeZone = async (db: Database): Promise<void> => {
  const result = await db.execute(sql`SELECT @@session.time_zone AS time_zone`)
  const actual = readFirstRow(result)?.['time_zone']
  if (actual !== EXPECTED_SESSION_TIME_ZONE) {
    throw new Error(`資料庫 session 時區必須是 ${EXPECTED_SESSION_TIME_ZONE}，實際為 ${actual}。`)
  }
}
```

呼叫點在 `apps/api/src/index.ts`，排在 `app.listen()` 之前、不接住例外：時區不符就是不要啟動，
讓服務起不來遠比讓它算錯薪資便宜。CI 也跑一次同一項自檢。

---

## 3. 「現在」必須由呼叫端注入

**這是本篇重點：業務程式碼禁止直接 `new Date()`／`Date.now()`，一律透過 `shared/clock.ts` 注入
的 `Clock` 取得「現在」。** 底層自己抓時間的話，跨日、月底、閏年、到期日這類邏輯根本無法測試——
你不能為了跑一條測試把機器時間調到 2 月 29 日，這類 bug 只會在真正的月底當天出現在正式環境
（§6.2）。

### 3.1 `Clock` 型別（`apps/api/src/shared/clock.ts`，全專案唯一允許讀系統時間的地方）

```ts
export type Clock = {
  now(): string // 業務時間 `YYYY-MM-DD HH:mm:ss`，台北牆鐘，不帶時區標記
  today(): string // 業務日期 `YYYY-MM-DD`
  minuteOfDay(): number // 當日第幾分鐘（0–1439）
  transportNow(): string // 傳輸層時戳，僅供 `rspTS`／`exp`
  after(seconds: number): string // 現在起 N 秒後的業務時間
  transportAfter(seconds: number): string // 現在起 N 秒後的傳輸層時戳，只供 `exp`
  epochMs(): number // 只供計算時間差，不得用來格式化業務時間
}

/** 正式環境使用的 clock。這是全專案唯一呼叫 `new Date()` 的位置。 */
export const systemClock: Clock = clockFrom(() => new Date())

/** 測試用：把「現在」釘在指定瞬間。 */
export const fixedClock = (instant: Date): Clock => clockFrom(() => instant)
```

### 3.2 service 怎麼收 clock

`Clock` 放進每個 service 的執行相依（context）型別，跟 `db`、`companyId` 平起平坐
（`apps/api/src/modules/employments/main/domain/employment-context.ts`）：

```ts
export type EmploymentsMainContext = {
  readonly db: Database
  /** 可注入的「現在」（§6.2）。 */
  readonly clock: Clock
  readonly companyId: string
  readonly operatorCompanyUserId: string
}
```

呼叫端在函式一開始就把「現在」問出來一次，後面重複使用同一個值，不要在函式中途再問第二次
（`employments-main.create.service.ts` 的 `createEmploymentInTransaction`）：

```ts
const now = context.clock.now()
// …insertEmployment(tx, context.companyId, { …, now })
// …recordAudit(tx, { …, now })
```

跨模組編排點（`employees/onboarding/impl/employees-onboarding.create.service.ts`）把同一個
`context.clock` 逐一轉交給每個子模組的 context（`clock: context.clock`），八個步驟共用同一支
時鐘，不會有「其中一步用了不同時間」這種對不起來的狀況。進程進入點 `apps/api/src/index.ts` 是
唯一組出 `systemClock` 並往下傳的地方：`buildApp({ clock: systemClock, database, cipher, … })`。

### 3.3 正確／錯誤對照

```ts
// ✅ 正確：時間由呼叫端傳入，測試可任意指定
function isWithinWindow(window: TimeWindow, minuteOfDay: number): boolean

// ❌ 錯誤：無法測試跨日與月底
function isWithinWindow(window: TimeWindow): boolean {
  const now = new Date() /* … */
}

// ✅ 正確：到期時刻由 clock.after() 產生，測試把 clock 釘死就能精確斷言
const expiresAt = context.clock.after(config.session.accessTokenTtlSeconds)

// ❌ 錯誤：自己用 Date 算出來的「現在＋TTL」，等於把「現在」重新引進來一次
const expiresAt = new Date(Date.now() + ttl * 1000)
```

**這條規則由 ESLint 擋，不是靠自律。** 根目錄 `eslint.config.js` 的 `no-restricted-syntax` 只抓
「零參數」的 `new Date()`（讀系統當下時間的唯一形狀，選擇器
`NewExpression[callee.name='Date'][arguments.length=0]`）與 `Date.now()`；`new Date('2026-…')`
這種把已知固定時刻轉成 `Date` 物件的寫法不算，因此測試裡 `fixedClock(new Date('2026-08-27T…'))`
不會被誤擋。例外只有兩處，是白名單而不是「先放這兩個之後陸續補」：`shared/clock.ts` 自己，以及
所有測試檔（`**/__tests__/**`、`*.test.ts`）。

### 3.4 跨午夜時段：用「當日第幾分鐘」，不要解析成 `Date`

跨午夜的時段以「當日第幾分鐘」表示，允許超過 1440（隔日）。用整數比大小，不要把 `HH:mm` 轉成
`Date` 再比較——那樣又會把系統時區重新引進計算裡。跨午夜時段的結束時刻會小於開始時刻，時長算成
負數就是「跨過午夜」的訊號（§6.2）。

---

## 4. 測試裡怎麼釘住「現在」

用 `fixedClock(new Date(...))` 建立一支固定時鐘，注入到 context 裡即可，不需要 mock 全域
`Date`；這個用法只出現在測試檔，`no-restricted-syntax` 對測試檔本來就關閉。真實範例
（`employments-main.endpoints.test.ts`）：

```ts
import { fixedClock } from '../../../../shared/clock.ts'

/** 釘住「現在」（§6.2）。台北時間 2026-08-27 12:00:00。 */
const clock = fixedClock(new Date('2026-08-27T04:00:00.000Z'))
```

注意這裡傳的是 **UTC 時刻**（`Z` 結尾）——`fixedClock` 內部一樣透過 `Intl.DateTimeFormat` 換算成
台北牆鐘再輸出，往前推 8 小時才對得上註解寫的台北時間，讓下一個讀測試的人不必自己心算時差。
跨日、月底、閏年這類邊界案例，直接改建構引數即可，不需要碰任何業務程式碼。

---

## 5. `scheduler/`：時間觸發的背景執行單元

### 5.1 判準（§0.6.4）

**由時間（或其他非 HTTP 的外部事件）觸發 ∧ 有生命週期（要 start／stop）∧ 一個程序只准存在一份。**
三項全成立才進 `scheduler/`；觸發來源是 HTTP 請求就是 `modules/`，三項成立但只是「算出現在該不
該跑」這種零 IO 判斷，就是純函式，屬於 `shared/` 或該模組的 `domain/`。目前唯一的實例是
`apps/api/src/scheduler/regulatory-sync-scheduler.ts`（法規資料每日同步）。

`scheduler/**` 只能 import `shared/**` 與 `modules/<大目錄>/index.ts`，不得 import `db/`、
`http/`、`app/`；合法的 import 者只有 `index.ts`（dependency-cruiser 硬性規則）。拿不到 `db` 是
刻意的——給了它資料庫連線，就等於讓「什麼時候跑」這一層有能力去改「怎麼跑」。

### 5.2 形狀：計時器、停止函式、關機註冊都是注入的

```ts
export type SchedulerTick = () => Promise<void>
export type StartSchedulerTimer = (intervalMs: number, tick: SchedulerTick) => () => void
export type RegisterShutdownSignal = (stopScheduler: () => Promise<void>) => void
```

理由與 clock 相同：測試要能**手動擊發**一次 tick，不必靠睡覺等真實時間過去；排程器本身不碰
`setInterval`／`process.on`，正式環境的計時器實作在 `index.ts`（見 5.4）。

### 5.3 只准啟動一次：`inFlight` 鎖，加上結構性保證

```ts
export const startRegulatorySyncScheduler = (dependencies: RegulatorySyncSchedulerDependencies): void => {
  const { clock, datasetCodes, runDatasetSync, startTimer, onShutdownSignal } = dependencies
  let lastRunDate: string | null = null
  let inFlight: Promise<void> | null = null // 同一個程序只跑一輪
  let stopping = false

  const tick: SchedulerTick = async () => {
    if (stopping || inFlight !== null) return // 上一輪還沒跑完：跳過，不排隊、不平行跑
    const today = clock.today()
    if (!shouldStartRound(today, clock.minuteOfDay(), lastRunDate)) return
    lastRunDate = today
    inFlight = runRound()
    try {
      await inFlight
    } finally {
      inFlight = null
    }
  }

  const stopTimer = startTimer(SCHEDULER_TICK_INTERVAL_MS, tick)
  let stopped: Promise<void> | null = null
  const stop = (): Promise<void> => {
    if (stopped !== null) return stopped // 必須冪等：SIGINT 之後再來一次 SIGTERM 很常見
    stopping = true
    stopTimer()
    stopped = (async () => {
      if (inFlight !== null) await inFlight // 等進行中的那一輪跑完，不強行砍斷
    })()
    return stopped
  }
  onShutdownSignal(stop)
}
```

- **「同一個程序內只跑一輪」靠 `inFlight` 這個閉包變數，「一個程序只准存在一份」靠結構保證**：
  `scheduler/**` 的合法 import 者只有 `index.ts`，而 `index.ts` 又規定「不得被任何檔案 import」
  （§0.6.2）——兩條規則疊起來，能啟動排程器的地方只有一處，且只執行一次。
- **跨程序的重複（水平擴展）刻意不在這裡處理**：那是 `runSync` 內部用資料庫那一列
  `status_code=1` 當鎖去擋（心跳逾時判死），排程器只是老實呼叫、拿到 `already-running` 就跳到
  下一個資料集，**不得在這裡再發明第二套鎖**——兩套鎖的存活判定一旦分岔，沒有任何測試會紅。
- **關機等進行中的那一輪跑完，不再開始新的一輪**，呼叫端必須 `await stop()` 才讓程序結束。

### 5.4 只有 `index.ts` 能啟動它

```ts
// apps/api/src/index.ts —— ✅ 正確：排程器由 index.ts 唯一啟動，clock 用 systemClock
import { startRegulatorySyncScheduler } from './scheduler/regulatory-sync-scheduler.ts'
import { systemClock } from './shared/clock.ts'

app.listen(config.port)

startRegulatorySyncScheduler({
  enabled: config.regulatorySyncScheduler.enabled,
  clock: systemClock,
  datasetCodes: SYNCABLE_DATASET_CODES,
  runDatasetSync: (datasetCode) =>
    runSync(regulatorySyncContext, { datasetCode, triggerTypeCode: RegulatorySyncTriggerType.Scheduled }),
  startTimer: startIntervalTimer,
  // 關機：先停排程器（等進行中的一輪跑完）、再停 app、最後才 process.exit(0)，順序不能反。
  onShutdownSignal: (stopScheduler) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      void (async () => {
        await stopScheduler()
        await app.stop()
        process.exit(0)
      })()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  },
})

// ❌ 錯誤：在 app/app.ts 裡啟動排程器
// app/ 是純組裝，bun run gen:api 要能只載入它就產出契約——計時器是副作用，只能在 index.ts（§0.6.2）。

// ❌ 錯誤：排程器自己 new Date() 判斷現在幾點
const nowHour = new Date().getHours() // 伺服器多半跑在 UTC，台北 03:00 會被算成前一天 19:00
```

新增第二個排程器時，判準與拒收表照抄 §0.6.7；不要因為「這個東西也是背景工作」就直接塞進既有的
`regulatory-sync-scheduler.ts`，先確認它是不是真的符合 §0.6.4 的三個條件。

---

## 6. 檢查清單

寫到任何跟時間有關的程式碼，照這張表逐項確認：

- [ ] 有沒有出現零引數的 `new Date()` 或 `Date.now()`？改成呼叫端注入的 `Clock`。
- [ ] service／domain 的 context 型別有沒有 `clock: Clock`？「現在」是否只在函式一開始問一次、
      重複使用同一個值？
- [ ] 這個時間欄位會不會顯示在畫面上？會 → `TaipeiDateTime`／`IsoDate`／`YearMonth`，禁止帶
      `+08:00`／`Z`；只給機器看（`rqTS`／`rspTS`／`exp`）→ `TransportTS`，不得當業務時間計算或
      顯示。schema 是否引用共用型別而非就地寫 `t.String()`？
- [ ] db schema 的日期／時間欄位是否宣告 `{ mode: 'string' }`？
- [ ] 測試需要固定時間時，是否用 `fixedClock(new Date(...))`，而不是修改系統時鐘或跳過斷言？
- [ ] 跨午夜時段判斷是否用「當日第幾分鐘」整數比大小，而不是解析成 `Date`？
- [ ] 這個新東西是否同時符合「時間觸發 ∧ 有生命週期 ∧ 一個程序只准一份」三條？符合才進
      `scheduler/`，否則留在 `shared/` 或該模組的 `domain/`。
- [ ] 排程器是否只被 `index.ts` import？計時器與關機註冊是否為呼叫端注入的函式，而非自己
      `setInterval`／`process.on`？跨程序重複是否已有資料庫層級的鎖（如 `runSync` 的心跳），
      沒有的話不要在排程器裡再發明第二套。
