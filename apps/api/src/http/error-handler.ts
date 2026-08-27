/**
 * 統一 error handler（§1.8.2、§3.1.2）。
 *
 * **只處理未攔截的例外與框架層錯誤。** 業務拒絕不走這裡——它在 service 內被收集起來，
 * 由邊界層映射（`error-boundary.ts`）。兩條路徑一旦混在一起，兩邊會同時壞掉：
 * 業務拒絕走例外，`errors` 陣列只剩一筆且告警被業務噪音淹沒；意外走收集，真正的 bug
 * 會被包成一句給使用者看的訊息回 `300`，堆疊消失、告警不響。
 */
import { Elysia } from 'elysia'
import type { Clock } from '../shared/clock.ts'
import { dataInvalid, systemError, type EnvelopeBody } from '../shared/envelope.ts'
import { LogCategory, logger } from '../shared/logger.ts'
import { HttpStatus, type HttpStatusValue } from './http-code-map.ts'
import { requestContext } from './request-context.ts'
import { finalizeEnvelope } from './response-envelope.ts'

/**
 * schema 驗證失敗時使用的錯誤碼。
 *
 * 它是平台層的碼、不屬於任何業務領域，因此不進各端點的 `errors[].code` 宣告清單（§1.8.3）
 * ——那份清單列的是**業務**錯誤，把每支端點都會有的格式錯誤抄進去只是噪音。
 */
const INVALID_FIELD_CODE = 'request.invalid-field'

/**
 * 收窄成可索引的物件。
 *
 * **刻意用型別述詞而不是物件展開**（`{ ...value }`）：展開只複製 own enumerable 屬性，
 * 而框架的錯誤物件把有用的東西放在 prototype 的 getter 上（Elysia 的 `ValidationError.all`
 * 就是），展開之後那些欄位會**靜靜消失**——讀出來永遠是 `undefined`，而不是任何錯誤。
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null)

/**
 * 把 TypeBox 的錯誤位置（`/items/2/startTime`）轉成 §1.3 規定的 dot-path（`items.2.startTime`）。
 *
 * 帶索引是必要的：本系統多處畫面是「同一種欄位在陣列中重複出現」的結構，
 * `field: "startTime"` 無法回答「是哪一筆的 startTime」，前端只能退化成全域提示，
 * 使用者面對一張五列的表格只被告知「時間格式錯誤」，得自己逐列比對。
 */
const toDotPath = (jsonPointer: string): string => jsonPointer.replace(/^\//, '').replaceAll('/', '.')

/**
 * schema 違規的一筆，**只進 log、不進回應**（§1.3：`100` 不附 `errors`）。
 *
 * 因此它刻意不是 `ErrorView`：`message` 是 TypeBox 產出的英文原文，不走訊息目錄
 * （`shared/i18n/messages.ts`）。硬要它變成一個 key，就得為每一種 TypeBox 錯誤在目錄裡編一則
 * 中文訊息，而那份訊息沒有任何使用者看得到——只是讓目錄多背一份會隨套件版本漂移的清單。
 */
type SchemaViolation = {
  readonly code: string
  readonly message: string
  readonly field: string
}

const readValidationErrors = (error: unknown): readonly SchemaViolation[] => {
  const record = asRecord(error)
  const all = record?.['all']
  if (!Array.isArray(all)) return []

  const violations: SchemaViolation[] = []
  for (const item of all) {
    const detail = asRecord(item)
    const path = detail?.['path']
    const message = detail?.['message']
    if (typeof path !== 'string') continue
    violations.push({
      code: INVALID_FIELD_CODE,
      message: typeof message === 'string' ? message : '(TypeBox 未附訊息)',
      field: toDotPath(path),
    })
  }
  return violations
}

const readStack = (error: unknown): string => {
  const record = asRecord(error)
  const stack = record?.['stack']
  if (typeof stack === 'string') return stack
  return String(error)
}

type FrameworkFailure = {
  readonly status: HttpStatusValue
  readonly body: EnvelopeBody<null>
}

/**
 * Elysia 交給 error handler 的錯誤代碼。
 *
 * **是 `string | number` 而不是 `string`**：框架自己的代碼是字面值（`'NOT_FOUND'`／`'VALIDATION'`…），
 * 但以 `status(...)` 拋出的自訂狀態碼回應會把 HTTP 數字直接當成 `code` 傳進來。
 * 刻意不把框架那份字面值清單抄一份進來：那份清單每個小版本都可能多一個
 * （`INVALID_FILE_TYPE` 就是 1.4 才加的），抄下來只會在升級時變成一個對不起來的聯集，
 * 而本函式對「清單上沒有的代碼」的處置本來就只有一種——落到 `default` 當成系統錯誤並記錄。
 */
type FrameworkErrorCode = string | number

const mapFrameworkError = (
  code: FrameworkErrorCode,
  error: unknown,
  traceId: string,
  path: string,
): FrameworkFailure => {
  switch (code) {
    case 'NOT_FOUND':
      // 404 必須獨立告警且門檻比 500 低（§1.3）：它通常代表前後端部署不同步，
      // 而那種問題在測試環境測不出來（兩邊都是最新的），一上線就是整片功能同時死掉。
      logger.warn(LogCategory.RouteNotFound, '請求的端點不存在', { traceId, path })
      return { status: HttpStatus.NotFound, body: systemError() }

    case 'VALIDATION': {
      // §1.8.0 的③與 §1.3：body schema 不符即 400／`code='100'` 且**不附 `errors`**，
      // 與下面的 PARSE 是同一類——契約已經定義好，送成這樣代表呼叫端沒照契約來。
      //
      // 出錯位置只進 log，不回給呼叫端。理由是 §1.3 對 `100` 的定調：那是開發期就該發現的
      // 問題，不是要在執行期引導使用者的問題；而前端的表單規則本來就由同一份 OpenAPI schema
      // 產生，會送出不合格的 body 代表兩邊已經對不上，這時候把欄位路徑回給它也接不上什麼。
      // 使用者層級的輸入問題會以 `300` 從 service 回來（§3.1.1），那條路才帶 `errors`。
      logger.warn(LogCategory.UnhandledException, 'request body 不符合 schema', {
        traceId,
        path,
        violations: readValidationErrors(error),
      })
      // 傳的是訊息 key，不是字串：翻譯只發生在出口層（§1.8.2，見 `response-envelope.ts`）。
      return { status: HttpStatus.BadRequest, body: dataInvalid('request.invalid-schema') }
    }

    case 'PARSE':
      // body 根本不是合法 JSON：契約已經定義好，送成這樣代表呼叫端沒照契約來，
      // 屬開發期問題而不是要引導使用者的問題，因此走 `100` 且不附 errors（§1.3）。
      logger.warn(LogCategory.UnhandledException, 'request body 無法解析', { traceId, path })
      return { status: HttpStatus.BadRequest, body: dataInvalid() }

    default:
      logger.error(LogCategory.UnhandledException, '未攔截的例外', {
        traceId,
        path,
        code,
        stack: readStack(error),
      })
      return { status: HttpStatus.InternalServerError, body: systemError() }
  }
}

export const errorHandler = (clock: Clock) =>
  new Elysia({ name: 'error-handler' })
    .use(requestContext)
    .onError({ as: 'global' }, (context): unknown => {
      // 404 與 500 在前端都是 `'400'`，兩者的差別只能靠 log 與 trace id 補回來（§1.3）。
      const traceId = crypto.randomUUID()
      context.set.headers['x-trace-id'] = traceId

      const failure = mapFrameworkError(context.code, context.error, traceId, context.path)
      context.set.status = failure.status

      // 走與成功路徑完全相同的出口（§1.8.4）：錯誤回應同樣要有 `cmd`／`locale`／`expiresIn`，
      // 否則前端的統一處理剛好在最需要它的時候失效。
      //
      // `requestContext` 在這裡是**可能不存在**的，不是型別寫壞了：它由 `derive` 建立，
      // 而 `PARSE`／`NOT_FOUND` 這兩種錯誤發生在 derive 跑到之前（body 還沒解析完、
      // 路由還沒配對到），那時候整個請求上下文都還沒建立。取不到就是 `null`，
      // 語意與「本次請求未經 Session 授權」完全相同（見 `request-context.ts`）：
      // `expiresIn`／`exp` 回 `null`，而不是讓出口層在最需要回應的錯誤路徑上炸掉。
      return finalizeEnvelope(failure.body, context.body, context.requestContext?.session ?? null, clock)
    })
