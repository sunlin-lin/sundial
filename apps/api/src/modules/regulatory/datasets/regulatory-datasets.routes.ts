/**
 * 法規資料集的端點目錄（§0.4「routes 不拆」、§1.9、計畫 §4.2）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。**權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換
 * （`/regulatory/datasets/list` → `regulatory.datasets.list`），由身分驗證 middleware 自己推導，
 * 且已由 migration `0014` seed。
 *
 * ## 兩支端點刻意不在這裡（計畫 D3）
 *
 * `/regulatory/datasets/raw`（看政府原始 Snapshot）與 `/regulatory/sync/trigger`（人工觸發同步）
 * **不開放**：觸發全平台同步、查看原始資料不該由某一家公司的管理者做，而目前的權限模型是
 * 「公司成員 ＋ 角色」，**沒有平台管理員這個概念**。照常開放的話，一家公司的管理者按一個鈕，
 * 效果是平台上每一家公司的 Payroll 都跟著換版本。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  IsoDate,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
} from '../../../shared/field-schemas.ts'
import { REGULATORY_DATASET_CODES } from './domain/regulatory-dataset-code.ts'
import { DATASET_VERSION_SORT_FIELDS } from './domain/regulatory-dataset-model.ts'
import { RegulatoryRecordDataSchema, type RegulatoryRecordData } from './domain/regulatory-record-shape.ts'
import {
  handleDatasetOverview,
  handleDatasetVersionGet,
  handleDatasetVersionList,
  handleDatasetVersionResolve,
  type RegulatoryDatasetsDependencies,
} from './regulatory-datasets.handler.ts'
import {
  describeRegulatoryDatasetErrors,
  REGULATORY_DATASET_ENDPOINT_ERRORS,
} from './regulatory-datasets.errors.ts'

/**
 * 資料集代碼，聯集字面值（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.Integer()`）。
 *
 * **由 `REGULATORY_DATASET_CODES` 推導而不是在這裡手打九個數字**：手打的那一份哪天少一個，
 * 症狀是那個資料集的端點回 `100 參數錯誤`——看起來像前端傳錯，實際上是路由的清單漏了。
 * 推導之後 `7`（永久空號）在型別與執行期都不存在，寫 `7` 是編譯錯誤而不是查不到資料。
 *
 * 這也是計畫 §4.4 那句「未知的 `datasetCode` 不是業務錯誤」的落點：它是列舉值，
 * 在這一行就被擋成 `100`（§2 的輸入驗證），不會走到 service。
 */
const DatasetCodeSchema = t.Union(REGULATORY_DATASET_CODES.map((code) => t.Literal(code)))

/**
 * `regulatory_dataset_versions.id`：BIGINT AUTO_INCREMENT（計畫 §3.2 (a)，全站第一批不用 uuid 的表）。
 *
 * 註：§2 要求共用欄位型別集中在 `shared/field-schemas.ts`，但目前全站只有法規三表用 bigint 主鍵，
 * 不在 §2 列舉的共用清單內（比照 `employees-main.routes.ts` 對員工特有欄位的處置）。
 * 第二個模組要用時應該升格上去（已寫進交付回報）。
 *
 * 上限用 `Number.MAX_SAFE_INTEGER`：schema 欄位在 TypeScript 端是 `number`（`mode: 'number'`），
 * 超過 2^53 的值在 JSON 解析的當下就已經失真了，讓它通過驗證只是把問題往後推一層。
 */
const DatasetVersionId = t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })

/**
 * 原始資料格式代碼，聯集字面值（§2）。
 *
 * 值必須與 `db/schema/regulatory-dataset-versions.ts` 的 `RegulatoryRawFormat` 相同。
 * **兩邊不一致時會編譯失敗**——handler 回的是 `RegulatoryRawFormatValue`，這裡多一個或少一個
 * 字面值，路由的委派呼叫當場對不上型別。不直接 import 那個常數，是為了讓路由層不相依資料庫 schema
 * （比照 `employees-main.routes.ts` 的 `GenderSchema`）。
 */
const RawFormatCodeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4), t.Literal(5)])

/**
 * DECIMAL(18,4) 欄位（`range_from`／`range_to`／`amount`）的對外形狀。
 *
 * **是字串，不是 number**（§4.7、計畫 §6.1）：Drizzle 讀 decimal 回傳字串，而轉成 float 的那一刻
 * 精度就沒了——級距比對在邊界值上會選錯級距，保費差幾百塊而薪資單上完全看不出異常。
 *
 * 不共用 `shared/field-schemas.ts` 的 `Money`：那一支只到小數兩位（`^-?\d{1,13}(?:\.\d{1,2})?$`），
 * 而 MariaDB 對 DECIMAL(18,4) 回的是補滿四位的 `20000.0000`，套 `Money` 會**驗不過**。
 * 兩者不是同一種值：`Money` 是使用者輸入與帳務金額，這裡是政府資料表的原始精度。
 */
const DecimalAmount = t.String({ pattern: '^-?\\d{1,14}(?:\\.\\d{1,4})?$' })

/** DECIMAL(18,8) 欄位（`rate`）的對外形狀。理由同 {@link DecimalAmount}，只是小數多四位。 */
const DecimalRate = t.String({ pattern: '^-?\\d{1,10}(?:\\.\\d{1,8})?$' })

/**
 * 版本清單的單筆。
 *
 * **沒有 `rawData`**（計畫 §3.2 (c)、§4.2）：它是 LONGTEXT，本表連 `SELECT *` 都禁止。
 * 這裡沒有它，不是因為「暫時不需要」，而是看原始 Snapshot 的端點刻意不開（計畫 D3）。
 */
const DatasetVersionSummarySchema = t.Object({
  id: DatasetVersionId,
  datasetCode: DatasetCodeSchema,
  versionCode: t.String({ minLength: 1, maxLength: 30 }),
  /** 生效日，台北的日曆日，不帶時區標記（§6.1）。 */
  effectiveFrom: IsoDate,
  /** 失效日。`null` 是常態——只在政府明示失效日時才寫入（計畫 §3.2 (d)）。 */
  effectiveTo: Nullable(IsoDate),
  /** 解析後筆數；`null` = 同步失敗或尚未解析。 */
  recordCount: Nullable(t.Integer({ minimum: 0 })),
  /** 業務時間，台北牆鐘、不帶時區標記（§6.1）。 */
  syncedAt: TaipeiDateTime,
  createdAt: TaipeiDateTime,
})

const DatasetVersionDetailSchema = t.Composite([
  DatasetVersionSummarySchema,
  t.Object({
    /** 本次取得的政府資源識別碼。**不是永久固定 URL**，只供事後追查（計畫 §7.0）。 */
    governmentResourceId: Nullable(t.String({ maxLength: 150 })),
    sourceModifiedAt: Nullable(TaipeiDateTime),
    checksum: t.String({ minLength: 1, maxLength: 128 }),
    rawFormatCode: RawFormatCodeSchema,
  }),
])

/**
 * 一筆 record。
 *
 * `data` 的形狀逐 `dataset_code` 定義（計畫 §6），這裡用的是全部形狀的聯集
 * ——本端點接受任何一個資料集代碼，回應形狀自然也是那些形狀的聯集。
 *
 * 用 `t.Unsafe` 包一層，是為了把**執行期 schema**（驗證與 OpenAPI 用的那份聯集）與
 * **靜態型別**（handler 真正回的那個可辨識聯集）接起來：`Type.Union(Object.values(...))`
 * 由一個陣列推導，TypeScript 只算得出 `unknown`，而 `unknown` 會讓 handler 回什麼都通過
 * ——那正是這個型別存在要防的事（計畫 §6：不能讓 `data` 以 `unknown` 流進去）。
 * schema 物件本身原樣帶過去，執行期的驗證一個字都沒放寬（同 `shared/envelope.ts` 的作法）。
 */
const RegulatoryRecordSchema = t.Object({
  id: DatasetVersionId,
  recordKey: t.String({ minLength: 1, maxLength: 150 }),
  code: Nullable(t.String({ maxLength: 100 })),
  name: Nullable(t.String({ maxLength: 250 })),
  rangeFrom: Nullable(DecimalAmount),
  rangeTo: Nullable(DecimalAmount),
  amount: Nullable(DecimalAmount),
  rate: Nullable(DecimalRate),
  data: t.Unsafe<RegulatoryRecordData>(RegulatoryRecordDataSchema),
  sortOrder: Nullable(t.Integer()),
})

const ResolvedDatasetSchema = t.Object({
  datasetCode: DatasetCodeSchema,
  /** 呼叫端送來的基準日，原樣回聲：已結算 Payroll 要能證明這一版是用哪一天解析出來的。 */
  asOfDate: IsoDate,
  version: DatasetVersionDetailSchema,
  records: t.Array(RegulatoryRecordSchema),
})

/** 列表的搜尋條件回聲（§1.4）。`datasetCode` 必填，因此這一包永遠有值。 */
const DatasetVersionSearchSchema = t.Object({ datasetCode: DatasetCodeSchema })

/**
 * 同步狀態代碼，聯集字面值（§2）。
 *
 * 值必須與 `db/schema/regulatory-sync-logs.ts` 的 `RegulatorySyncStatus` 相同
 * （1 執行中／2 成功／3 失敗／4 無異動）。**與 `sync/regulatory-sync.routes.ts` 各自宣告一份**，
 * 不共用一個常數：路由層不相依資料庫 schema 是本模組既有的慣例（比照 {@link DatasetCodeSchema}
 * 與 {@link RawFormatCodeSchema} 的處置），兩邊各自宣告，值不一致時各自的型別檢查會分別失敗。
 */
const SyncStatusCodeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)])

/** 總覽一列裡「適用版本」。只有總覽要顯示的三欄，不是 {@link DatasetVersionSummarySchema} 的別名。 */
const DatasetOverviewVersionSchema = t.Object({
  versionCode: t.String({ minLength: 1, maxLength: 30 }),
  effectiveFrom: IsoDate,
  recordCount: Nullable(t.Integer({ minimum: 0 })),
})

/**
 * 總覽一列裡「最近一次同步」，判別聯集（任務一）。
 *
 * **`kind` 是這一格的核心，取代用 `null` 表達兩種不同的意思**（任務一原文的提示）：
 * 人工維護的資料集（`10`）永遠是 `not-applicable`——那是規格，不是同步壞了；
 * 自動同步但排程還沒跑過的資料集是 `never-synced`；其餘才帶著實際的時間與狀態碼。
 * 前端只要看 `kind` 就知道要顯示哪一種文案（「不適用」或「尚未同步」或實際時間），不必用猜的。
 */
const DatasetOverviewLastSyncSchema = t.Union([
  t.Object({ kind: t.Literal('not-applicable') }),
  t.Object({ kind: t.Literal('never-synced') }),
  t.Object({
    kind: t.Literal('synced'),
    /** 業務時間，台北牆鐘、不帶時區標記（§6.1）。 */
    startedAt: TaipeiDateTime,
    /** `statusCode=1 執行中` 時為 `null`。 */
    finishedAt: Nullable(TaipeiDateTime),
    statusCode: SyncStatusCodeSchema,
  }),
])

/**
 * 總覽一列。
 *
 * **`name` 與 `maintenance` 由後端回傳，前端不必自己維護第二份「代碼 → 名稱」對照**
 * （任務一）：那份對照原本只存在於文件與 `REGULATORY_DATASETS` 常數兩處，
 * `check:dataset-code` 只比對這兩處；一旦前端語系檔也抄一份，就是第三份，
 * 對調兩個名稱不會有任何一處變紅。端點直接回名稱，第三份就沒有存在的必要。
 */
const DatasetOverviewRowSchema = t.Object({
  datasetCode: DatasetCodeSchema,
  name: t.String({ minLength: 1, maxLength: 100 }),
  maintenance: t.Union([t.Literal('sync'), t.Literal('manual')]),
  /** 該基準日沒有任何一版涵蓋時為 `null`（§3.1.3）；九列固定都在，這一欄為 `null` 不代表整列消失。 */
  effectiveVersion: Nullable(DatasetOverviewVersionSchema),
  lastSync: DatasetOverviewLastSyncSchema,
})

/**
 * 每支端點都可能出現的非業務回應。
 *
 * §2 要求 `response` 涵蓋該端點可能回的每一種狀態碼。這三種與業務邏輯無關，由 middleware 與
 * 統一 error handler 產生（`900` 未登入／`901` 無權限／`400` 系統錯誤），`data` 恆為 `null`、
 * `errors` 恆為空陣列（§1.3）。
 *
 * **`500` 在本模組不是理論上的可能性**：`data` 讀出後驗不過就走這一條（計畫 §6），
 * 那是刻意的設計而不是意外——資料是幾個月前另一版程式寫進去的，形狀對不上時要有人去看堆疊。
 */
const CommonFailureResponses = {
  401: envelope(t.Null()),
  403: envelope(t.Null()),
  500: envelope(t.Null()),
} as const

/**
 * 法規資料集的端點。
 *
 * @param dependencies 由組裝點注入的資料庫連線。**沒有 clock、也沒有公司範圍**：
 *   前者是為了讓「`asOfDate` 沒帶就用今天」寫不出來（計畫 §4.2），後者是因為法規三表
 *   本來就沒有 `company_id`（計畫 §3.2 (b)）。
 */
export const regulatoryDatasetsRoutes = (dependencies: RegulatoryDatasetsDependencies) =>
  new Elysia({ name: 'regulatory-datasets-routes' })
    .use(requestContext)
    .post('/regulatory/datasets/list', (context) => handleDatasetVersionList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('regulatory.datasets.list'),
        datasetCode: DatasetCodeSchema,
        ...PageRequest,
        sort: t.Optional(sortRequest(DATASET_VERSION_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(DatasetVersionSearchSchema, DatasetVersionSummarySchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢某個法規資料集的版本清單',
        description:
          `${describeRegulatoryDatasetErrors(REGULATORY_DATASET_ENDPOINT_ERRORS.list)}` +
          ' 回應不含政府原始 Snapshot（raw_data）。',
      },
    })
    .post('/regulatory/datasets/get', (context) => handleDatasetVersionGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('regulatory.datasets.get'), id: DatasetVersionId }),
      response: {
        // 查無資料是 `data: null`，不是 404、也不是業務錯誤（§1.3、§3.1.3）。
        200: envelope(Nullable(DatasetVersionDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一法規資料版本的 metadata（不含 raw_data）',
        description:
          `${describeRegulatoryDatasetErrors(REGULATORY_DATASET_ENDPOINT_ERRORS.get)}` +
          ' 查無此版本時回 data: null。',
      },
    })
    .post('/regulatory/datasets/resolve', (context) => handleDatasetVersionResolve(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('regulatory.datasets.resolve'),
        datasetCode: DatasetCodeSchema,
        // **必填，而且沒有 `default`**（計畫 §4.2）：給了預設值之後，補算去年 12 月的薪資
        // 會抓到今年的費率，算出一個完全合理的數字，沒有任何一層會發現不對。
        asOfDate: IsoDate,
      }),
      response: {
        // 該基準日沒有適用版本時回 `data: null`（§3.1.3）。同一件事對 Payroll 那一側
        // 是 `ServiceResult` 的失敗分支，見 `regulatory-datasets.errors.ts`。
        200: envelope(Nullable(ResolvedDatasetSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '依資料集與法規適用基準日取適用版本及其 records',
        description:
          `${describeRegulatoryDatasetErrors(REGULATORY_DATASET_ENDPOINT_ERRORS.resolve)}` +
          ' asOfDate 必填且不預設今天；該基準日無適用版本時回 data: null。金額與費率一律為 decimal 字串。',
      },
    })
    .post('/regulatory/datasets/overview', (context) => handleDatasetOverview(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('regulatory.datasets.overview'),
        // **必填，且沒有 `default`**（計畫 §4.2、任務一）：理由與 `resolve` 的 `asOfDate` 逐字相同
        // ——不預設今天，否則補算去年 12 月的薪資會抓到今年的費率，算出一個完全合理的數字。
        asOfDate: IsoDate,
      }),
      response: {
        // 九列固定回傳（見 domain 的 `DatasetOverviewRow` 說明），因此不是 `Nullable`，
        // 也不是分頁的 `paginationResponse`——這不是一個會變長、需要翻頁的清單，是固定筆數的總覽。
        200: envelope(t.Array(DatasetOverviewRowSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '九個法規資料集在某一基準日的總覽（不回 records）',
        description:
          `${describeRegulatoryDatasetErrors(REGULATORY_DATASET_ENDPOINT_ERRORS.overview)}` +
          ' asOfDate 必填且不預設今天；九個資料集固定各一列，即使某一列在該基準日沒有適用版本' +
          '（effectiveVersion: null）。人工維護的資料集（10）的 lastSync.kind 恆為 not-applicable，' +
          '自動同步但尚未有任何紀錄的資料集為 never-synced；內容請改打 resolve 或 list。',
      },
    })
