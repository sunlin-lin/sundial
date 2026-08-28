/**
 * 法規同步的端點目錄（§0.4「routes 不拆」、§1.9、計畫 §4.2）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。**權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換
 * （`/regulatory/sync/list` → `regulatory.sync.list`），由身分驗證 middleware 自己推導，
 * 且已由 migration `0016` seed。
 *
 * ## 這裡只有一支端點，而缺席的那一支才是重點（計畫 D3）
 *
 * `/regulatory/sync/trigger`（人工觸發同步）**不開放**：`晷光示範股份有限公司` 的管理者按一次，
 * 效果是重抓政府資料、寫入新版本，**平台上每一家公司的 Payroll 都跟著換版本**
 * ——一家公司的管理者，按一個鈕，影響全平台。目前的權限模型是「公司成員 ＋ 角色」，
 * 沒有平台管理員這個概念，因此那支端點連權限碼都沒有 seed。
 *
 * 同步由伺服器端的程序呼叫 `runSync`（見 `regulatory-sync.service.ts` 檔頭）。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
} from '../../../shared/field-schemas.ts'
import { REGULATORY_DATASET_CODES } from '../datasets/domain/regulatory-dataset-code.ts'
import { SYNC_LOG_SORT_FIELDS } from './domain/regulatory-sync-model.ts'
import { handleSyncLogList, type RegulatorySyncDependencies } from './regulatory-sync.handler.ts'
import { describeRegulatorySyncErrors, REGULATORY_SYNC_ENDPOINT_ERRORS } from './regulatory-sync.errors.ts'

/**
 * 資料集代碼，聯集字面值（§2）。
 *
 * **由 `REGULATORY_DATASET_CODES` 推導而不是手打九個數字**（同 `datasets` 那一側）：
 * 手打的那一份哪天少一個，症狀是那個資料集的端點回 `100 參數錯誤`——看起來像前端傳錯，
 * 實際上是路由的清單漏了。
 *
 * 這裡**收的是全部九個代碼，不是只有「同步得了的那些」**：同步歷程要查得到
 * 「這個資料集還沒有任何同步紀錄」，而那正是目前八個資料集的狀態。
 */
const DatasetCodeSchema = t.Union(REGULATORY_DATASET_CODES.map((code) => t.Literal(code)))

/**
 * `regulatory_sync_logs.id`／`dataset_version_id`：BIGINT AUTO_INCREMENT（計畫 §3.2 (a)）。
 *
 * 上限用 `Number.MAX_SAFE_INTEGER`：schema 欄位在 TypeScript 端是 `number`（`mode: 'number'`），
 * 超過 2^53 的值在 JSON 解析的當下就已經失真了。
 */
const BigIntId = t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

/**
 * 同步狀態代碼，聯集字面值（§2）。
 *
 * 值必須與 `db/schema/regulatory-sync-logs.ts` 的 `RegulatorySyncStatus` 相同
 * （1 執行中／2 成功／3 失敗／4 無異動）。**兩邊不一致時會編譯失敗**——handler 回的是
 * `RegulatorySyncStatusValue`，這裡多一個或少一個字面值，路由的委派呼叫當場對不上型別。
 * 不直接 import 那個常數，是為了讓路由層不相依資料庫 schema（比照 `datasets` 的處置）。
 */
const SyncStatusCodeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)])

/** 觸發方式代碼（1 自動排程／2 人工），聯集字面值（§2）。理由同 {@link SyncStatusCodeSchema}。 */
const SyncTriggerTypeCodeSchema = t.Union([t.Literal(1), t.Literal(2)])

/**
 * 同步歷程的一筆。
 *
 * `errorMessage` 在對外契約上是 `Nullable`，而且**沒有長度上限**：它在資料表是 TEXT，
 * 而截斷一則失敗原因等於把最有用的那一段（通常在後面）丟掉。
 */
const SyncLogSummarySchema = t.Object({
  id: BigIntId,
  datasetCode: DatasetCodeSchema,
  triggerTypeCode: SyncTriggerTypeCodeSchema,
  /** 業務時間，台北牆鐘、不帶時區標記（§6.1）。 */
  startedAt: TaipeiDateTime,
  /** `status_code=1 執行中` 時為 `null`。 */
  finishedAt: Nullable(TaipeiDateTime),
  statusCode: SyncStatusCodeSchema,
  /** 本次產生或辨識出的版本；失敗與執行中時為 `null`。 */
  datasetVersionId: Nullable(BigIntId),
  /** 本次 resource discovery 抓到的資源網址。**不是永久固定 URL**（計畫 §7.0）。 */
  governmentResourceId: Nullable(t.String({ maxLength: 150 })),
  recordsReceived: Nullable(t.Integer({ minimum: 0 })),
  /** 失敗原因。`status_code=3` 時必有值——這一欄就是這張表存在的理由（計畫 §3.4）。 */
  errorMessage: Nullable(t.String()),
  /** 同步程序存活訊號（計畫 §3.4，決策 D2）。 */
  heartbeatAt: TaipeiDateTime,
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** 列表的搜尋條件回聲（§1.4）。`datasetCode` 必填，因此這一包永遠有值。 */
const SyncLogSearchSchema = t.Object({ datasetCode: DatasetCodeSchema })

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。這三種與業務邏輯無關，由 middleware 與
 * 統一 error handler 產生（`900` 未登入／`901` 無權限／`400` 系統錯誤），`data` 恆為 `null`、
 * `errors` 恆為空陣列（§1.3）。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/**
 * 法規同步的端點。
 *
 * @param dependencies 由組裝點注入的資料庫連線。**沒有 clock、沒有 `fetch`、沒有計時器**：
 *   這支端點只讀歷程，給它那三樣就等於讓一支 HTTP 查詢有能力去打政府端點並寫入版本。
 */
export const regulatorySyncRoutes = (dependencies: RegulatorySyncDependencies) =>
  new Elysia({ name: 'regulatory-sync-routes' })
    .use(requestContext)
    .post('/regulatory/sync/list', (context) => handleSyncLogList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('regulatory.sync.list'),
        datasetCode: DatasetCodeSchema,
        ...PageRequest,
        sort: t.Optional(sortRequest(SYNC_LOG_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(SyncLogSearchSchema, SyncLogSummarySchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢某個法規資料集的同步歷程',
        description:
          `${describeRegulatorySyncErrors(REGULATORY_SYNC_ENDPOINT_ERRORS.list)}` +
          ' 尚未同步過的資料集回空清單。errorMessage 為失敗原因，僅在 statusCode=3 時有值。',
      },
    })
