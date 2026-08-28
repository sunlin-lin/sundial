/**
 * 班別主檔的端點目錄（§0.4「routes 不拆」、§1.9）。
 *
 * 這個檔案的用途是**一眼看完這個次實體對外開了哪些口、各自收什麼、回什麼**，因此它只有宣告，
 * 沒有任何函式本體——業務在 service，資料收斂在 handler。
 *
 * **這裡看不到任何「這支要不要驗身分」的字眼**（§1.9.1）：認證方式是群組的屬性，由路由組裝點
 * 把整個 plugin 掛進已登入群組。
 *
 * **權限碼也不在這裡宣告**（§5.2.2）：它等於路徑的機械轉換（`/shifts/main/list` →
 * `shifts.main.list`），由身分驗證 middleware 自己推導。
 *
 * ---
 *
 * **本檔的 request schema 裡完全沒有 `isOvernight`／`requiredWorkMinutes`／`workMinutes`／
 * `breakMinutes` 這四個欄位**（計畫 §4.1，已定案）。這不是遺漏，是刻意的：這四個值一律由 service
 * 依時段與休息的起訖時間計算，**不收**呼叫端送來的值——收了就要處理「送進來的跟算出來的不一樣」
 * 這種情況，而任何處置都要有人決定一次；不收就沒有這個問題。
 *
 * **`workPeriods` 不在 schema 層設 `minItems: 1`**：「至少要有一段工作時段」（計畫 §5.2）與
 * 「工作時段不得重疊」「休息必須落在工作時段內」是同一類規則——都要先看過整組資料才判斷得出來，
 * 因此本模組把它們全部集中在 `domain/shift-validation.ts` 一起檢查、一起回報（§3.1.1 的
 * 「一次違反多條規則要一次全部回報」）。拆一半到 schema 層（400／`code=100`，`errors` 恆為空）、
 * 一半留在 service（422／`code=300`，帶 `errors`），使用者送出一張全空的表單會先撞見一個沒有
 * `errors[]` 可用的通用錯誤，改完送出才會撞見第二種格式的錯誤——同一張表單卻要用兩種方式呈現。
 */
import { Elysia, t } from 'elysia'
import { requestContext } from '../../../http/request-context.ts'
import { envelope } from '../../../shared/envelope.ts'
import {
  BaseRequest,
  codeField,
  Nullable,
  PageRequest,
  paginationResponse,
  sortRequest,
  TaipeiDateTime,
  Uuid,
} from '../../../shared/field-schemas.ts'
import { SHIFT_SORT_FIELDS } from './domain/shift-list-view.ts'
import {
  handleShiftCopy,
  handleShiftCreate,
  handleShiftDelete,
  handleShiftGet,
  handleShiftList,
  handleShiftUpdate,
  type ShiftsMainDependencies,
} from './shifts-main.handler.ts'
import { describeShiftErrors, SHIFT_ENDPOINT_ERRORS } from './shifts-main.errors.ts'

/**
 * 班別代碼。字元格式與長度上限說明見 {@link codeField}——長度對齊
 * `shift_definitions.code` 的 `VARCHAR(64)`。
 */
const ShiftCode = codeField(64)

/** 班別名稱。長度上限對齊 `shift_definitions.name` 的 `VARCHAR(128)`。 */
const ShiftName = t.String({ minLength: 1, maxLength: 128 })

/**
 * 班別說明。**必須非空字串**（計畫 §10，已定案）：DB 是 `text NOT NULL`，但空字串通得過
 * `NOT NULL`——那是最糟的一種：看起來必填、實際上不是。上限 1000 是本計畫訂的合理上限
 * （`text` 欄位本身沒有天然上限），避免任意長度的字串塞爆稽核與畫面呈現。
 *
 * 這張表的核心規則是「停用舊的、複製建立新的」（計畫 §7），於是同一家公司會累積出一批
 * **只差幾分鐘、名稱又相近**的班別，半年後分辨它們靠的就是說明。
 */
const ShiftDescription = t.String({ minLength: 1, maxLength: 1000 })

/**
 * 工時管理方式代碼，聯集字面值（§2：固定代碼欄位必須用聯集字面值，不可只寫 `t.Integer()`）。
 *
 * 值必須與 `db/schema/shift-definitions.ts` 的 `ShiftWorkType` 相同（`1 一般`、`2 輪班`、
 * `3 彈性`、`4 責任制`，計畫 §5.1、§10）。**兩邊不一致時會編譯失敗**——handler 收的是
 * `ShiftWorkTypeValue`，這裡多一個或少一個字面值，路由的委派呼叫當場對不上型別。
 * 不直接 import 那個常數，是為了讓路由層不相依資料庫 schema。
 */
const ShiftWorkTypeSchema = t.Union([t.Literal(1), t.Literal(2), t.Literal(3), t.Literal(4)])

/**
 * 不含日期的時刻 `HH:mm`（後端規範 §6.1）。班別的所有時段起訖都是這個格式，日偏移另外用
 * {@link ShiftDayOffset} 表達跨日，不把兩者合成單一欄位（合成會讓 `HH:mm` 的樣式驗證失效）。
 */
const ShiftClockTime = t.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })

/**
 * 日偏移。`0` 或 `1`——本計畫的班別以「一天怎麼上班」為框架（計畫 §1），時段最長跨到隔天，
 * 不支援跨兩個以上日曆日的單一時段或休息。
 */
const ShiftDayOffset = t.Integer({ minimum: 0, maximum: 1 })

/** 時段／休息在同一班別內的順序，從 1 起算（由呼叫端指定，不是資料庫自動編號）。 */
const ShiftSequenceNo = t.Integer({ minimum: 1 })

/**
 * 工作時段（輸入方向）。**沒有 `workMinutes`**——推導值，見本檔檔頭。
 */
const ShiftWorkPeriodInputSchema = t.Object({
  sequenceNo: ShiftSequenceNo,
  startTime: ShiftClockTime,
  endTime: ShiftClockTime,
  endDayOffset: ShiftDayOffset,
})

/**
 * 休息時段（輸入方向）。**沒有 `breakMinutes`**——推導值，見本檔檔頭。含 `startDayOffset`，
 * 這是計畫對資料字典的唯一增補（計畫 §4.2）：沒有它，跨日班的休息分不出是開始前還是開始後。
 */
const ShiftBreakInputSchema = t.Object({
  sequenceNo: ShiftSequenceNo,
  startTime: ShiftClockTime,
  endTime: ShiftClockTime,
  startDayOffset: ShiftDayOffset,
  endDayOffset: ShiftDayOffset,
  isPaid: t.Boolean(),
})

/** 建立與修改共用的基本欄位。兩支端點收的欄位完全相同，差別只在 `update` 多一個 `id`。 */
const ShiftProfileFields = {
  code: ShiftCode,
  name: ShiftName,
  workTypeCode: ShiftWorkTypeSchema,
  isFlexible: t.Boolean(),
  description: ShiftDescription,
  isActive: t.Boolean(),
  workPeriods: t.Array(ShiftWorkPeriodInputSchema),
  breaks: t.Array(ShiftBreakInputSchema),
} as const

/** 工作時段（輸出方向）：多了推導出的 `workMinutes`。 */
const ShiftWorkPeriodDataSchema = t.Object({
  sequenceNo: ShiftSequenceNo,
  startTime: ShiftClockTime,
  endTime: ShiftClockTime,
  endDayOffset: ShiftDayOffset,
  workMinutes: t.Integer({ minimum: 0 }),
})

/** 休息時段（輸出方向）：多了推導出的 `breakMinutes`。 */
const ShiftBreakDataSchema = t.Object({
  sequenceNo: ShiftSequenceNo,
  startTime: ShiftClockTime,
  endTime: ShiftClockTime,
  startDayOffset: ShiftDayOffset,
  endDayOffset: ShiftDayOffset,
  breakMinutes: t.Integer({ minimum: 0 }),
  isPaid: t.Boolean(),
})

/**
 * 列表單筆與明細共用的基本形狀。**含完整的工作時段與休息時段**（UI 定案要求列表要顯示這兩欄，
 * 見 `domain/shift-model.ts` 的 `ShiftSummary` 說明）。
 */
const ShiftSummarySchema = t.Object({
  id: Uuid,
  code: ShiftCode,
  name: ShiftName,
  workTypeCode: ShiftWorkTypeSchema,
  /** 推導值（計畫 §4.1）：任一工作時段的 `endDayOffset > 0`。 */
  isOvernight: t.Boolean(),
  isFlexible: t.Boolean(),
  /** 推導值（計畫 §4.1）：工作時段分鐘總和 － 無薪休息分鐘總和；可能為 0，理論上也可能為負。 */
  requiredWorkMinutes: t.Integer(),
  isActive: t.Boolean(),
  workPeriods: t.Array(ShiftWorkPeriodDataSchema),
  breaks: t.Array(ShiftBreakDataSchema),
})

const ShiftDetailSchema = t.Object({
  id: Uuid,
  code: ShiftCode,
  name: ShiftName,
  workTypeCode: ShiftWorkTypeSchema,
  isOvernight: t.Boolean(),
  isFlexible: t.Boolean(),
  requiredWorkMinutes: t.Integer(),
  isActive: t.Boolean(),
  workPeriods: t.Array(ShiftWorkPeriodDataSchema),
  breaks: t.Array(ShiftBreakDataSchema),
  description: ShiftDescription,
  /** 業務時間，台北牆鐘、不帶時區標記（§6.1）：帶了標記前端會依瀏覽器時區再換算一次。 */
  createdAt: TaipeiDateTime,
  updatedAt: TaipeiDateTime,
})

/** 列表的搜尋條件回聲（§1.4）。使用者沒送的條件就不出現，前端才比對得出這包是不是自己要的。 */
const ShiftSearchSchema = t.Object({
  keyword: t.Optional(t.String({ maxLength: 128 })),
  workTypeCode: t.Optional(ShiftWorkTypeSchema),
  isOvernight: t.Optional(t.Boolean()),
  isFlexible: t.Optional(t.Boolean()),
  isActive: t.Optional(t.Boolean()),
})

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

/** 業務錯誤的回應形狀。409 與 422 在 envelope 上都是 `code='300'`，差別只在錯誤分組（§1.3）。 */
const BusinessFailureResponses = {
  409: envelope(t.Null()),
  422: envelope(t.Null()),
} as const

/**
 * 班別主檔的端點。
 *
 * @param dependencies 由組裝點注入的資料庫與 clock。**不在模組層建立連線**（§1.7）：
 *   `bun run gen:api` 必須能在資料庫未連線的情況下產出契約，否則新人的第一天就會卡在這裡。
 */
export const shiftsMainRoutes = (dependencies: ShiftsMainDependencies) =>
  new Elysia({ name: 'shifts-main-routes' })
    .use(requestContext)
    .post('/shifts/main/list', (context) => handleShiftList(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('shifts.main.list'),
        keyword: t.Optional(t.String({ maxLength: 128 })),
        workTypeCode: t.Optional(ShiftWorkTypeSchema),
        isOvernight: t.Optional(t.Boolean()),
        isFlexible: t.Optional(t.Boolean()),
        /** 不篩選就是「不帶這個欄位」；**沒帶時 handler 補上 `true`**（UI 定案：預設顯示啟用班別）。 */
        isActive: t.Optional(t.Boolean()),
        ...PageRequest,
        sort: t.Optional(sortRequest(SHIFT_SORT_FIELDS)),
      }),
      response: {
        200: envelope(paginationResponse(ShiftSearchSchema, ShiftSummarySchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢班別清單',
        description: `${describeShiftErrors(SHIFT_ENDPOINT_ERRORS.list)} 預設只回啟用班別，未帶 isActive 時等同 isActive=true。`,
      },
    })
    .post('/shifts/main/get', (context) => handleShiftGet(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('shifts.main.get'), id: Uuid }),
      response: {
        // 查無資料是 `data: null`，不是 404（§1.3）。別家公司的班別也回這一種（§3.2）。
        200: envelope(Nullable(ShiftDetailSchema)),
        ...CommonFailureResponses,
      },
      detail: {
        summary: '查詢單一班別（含工作時段與休息時段）',
        description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.get),
      },
    })
    .post('/shifts/main/create', (context) => handleShiftCreate(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('shifts.main.create'), ...ShiftProfileFields }),
      response: {
        200: envelope(ShiftDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '新增班別（含工作時段與休息時段）',
        description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.create),
      },
    })
    .post('/shifts/main/update', (context) => handleShiftUpdate(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('shifts.main.update'),
        id: Uuid,
        ...ShiftProfileFields,
        // 啟用／停用走本端點的 `isActive`，不另開端點（計畫 §6 明定）：它只是一個欄位值，
        // 另開端點會讓「改狀態」與「改內容」走兩條路，而兩條路的稽核與權限要各自維護。
      }),
      response: {
        200: envelope(ShiftDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '修改班別（含工作時段與休息時段，全量替換；亦用於啟用／停用）',
        description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.update),
      },
    })
    .post('/shifts/main/copy', (context) => handleShiftCopy(dependencies, context), {
      body: t.Object({
        ...BaseRequest,
        cmd: t.Literal('shifts.main.copy'),
        sourceId: Uuid,
        code: ShiftCode,
        name: ShiftName,
        description: ShiftDescription,
        isActive: t.Boolean(),
        // 刻意沒有 workTypeCode／isFlexible／workPeriods／breaks：內容整組取自來源班別
        // （計畫 §7），見本檔上方對 `CopyShiftInput` 的說明與 `domain/shift-model.ts`。
      }),
      response: {
        200: envelope(ShiftDetailSchema),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '複製班別（停用舊班別並複製建立新班別流程的工具端點；不自動停用來源）',
        description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.copy),
      },
    })
    .post('/shifts/main/delete', (context) => handleShiftDelete(dependencies, context), {
      body: t.Object({ ...BaseRequest, cmd: t.Literal('shifts.main.delete'), id: Uuid }),
      response: {
        // 軟刪除（§4.3）：只回識別碼，刪掉之後沒有「變更後的完整資源」可回。
        200: envelope(t.Object({ id: Uuid })),
        ...BusinessFailureResponses,
        ...CommonFailureResponses,
      },
      detail: {
        summary: '刪除班別（軟刪除）',
        description: describeShiftErrors(SHIFT_ENDPOINT_ERRORS.delete),
      },
    })
