/**
 * 從「已註冊的路由」讀出對外契約的清單（§1.7 的端點清單快照）。
 *
 * ## 為什麼需要這個檔案
 *
 * code-first 的 OpenAPI 是產生物、不進版控（§1.7），於是**對外契約的變更不會出現在 PR diff 裡**：
 * 改一行 schema 就悄悄改了 API，reviewer 什麼也看不到。端點清單快照是把契約變更重新拉回 diff
 * 的替代把關機制——路徑改名、欄位從選填變必填、端點被刪掉、**端點被搬到另一個認證群組**，
 * 都會在 PR 上變成一段紅綠對照。
 *
 * 本檔只負責「把契約讀出來、整理成可比對的資料」，比對與快照檔由
 * `__tests__/endpoint-inventory.test.ts` 負責。分開是因為契約產生腳本（`scripts/generate-api.ts`）
 * 也要同一份清單（它要知道每支端點的 `path` 與 `cmd` 才產得出前端 client），
 * 兩邊各讀一次 Elysia 內部結構就是兩份會分岔的剖析邏輯。
 *
 * ## 讀的是執行期的路由物件，不是原始碼
 *
 * 不掃 AST。理由是這裡要回答的問題是「**實際被註冊起來的**端點有哪些」，而那與「原始碼裡寫了
 * 哪些 `.post(...)`」是兩件事：一個模組的 routes 檔寫得再完整，只要組裝點忘了 `.use()` 它，
 * 它就不存在——而那正是最該被快照抓到的一種變更。組裝起來再問它，答案沒有第二種解釋。
 *
 * ## 順帶做了兩項 §1.7／§2 標了 ✅ 的檢查
 *
 * 這兩項本來要另外寫掃描腳本，但在這裡幾乎是免費的（資料已經在手上），而且比掃描精確：
 *
 * 1. **每支端點都必須宣告 request body schema，且 `cmd` 收窄成字面值**——讀不到就中止。
 *    少宣告一個 body schema，產生出來的 OpenAPI 在那個端點就是個空洞，前端唯一的出路是
 *    自己手寫一份 interface，於是「禁止手寫 DTO」被迫破例。
 * 2. **200 的 response schema 必須是 `envelope(...)` 的呼叫結果**——比對的是
 *    `allOf[0]` 是否**就是** `BaseResponse` 那個物件本身（`===`）。手寫 `t.Object({ code: ... })`
 *    即使欄位一字不差也過不了，因為那是另一個物件；而這正是規範要擋的東西
 *    （§1.7：「直接寫 `t.Object({ code: ... })` 即失敗」）。
 */
import { BaseResponse } from '../shared/envelope.ts'
import { toCommandCode } from '../shared/path-code.ts'
import type { AppDependencies } from './app-dependencies.ts'
import { buildApp } from './app.ts'
import { AUTHENTICATION_GROUPS, type AuthenticationGroupId } from './routes.ts'

/**
 * 不屬於任何認證群組、且**刻意如此**的路由（§1.9.2 的排除適用範圍，不是例外）。
 *
 * 基礎設施端點的呼叫者是 load balancer、監控與部署腳本，不是 Web 前端，因此不在對外契約的
 * 管轄範圍內（見 `http/infrastructure-endpoints.ts`）。**必須逐條列出而不是「非 POST 就略過」**：
 * 補集要可枚舉（通用規範 §7.6），否則哪天有人在群組外註冊了一支 POST 業務端點
 *（＝一支不驗任何憑證的端點），這裡會安靜地把它當成基礎設施放過去。
 */
const INFRASTRUCTURE_ROUTES: ReadonlySet<string> = new Set(['GET /health'])

/** 快照上的一支端點。欄位的取捨理由見 {@link serializeEndpointContracts}。 */
export type EndpointContract = {
  /** 憑證在契約上的位置（§1.7）：憑證不進 body、不進 `parameters`，只有這一欄記得住。 */
  readonly authGroup: AuthenticationGroupId
  readonly path: string
  /** 端點宣告的 `cmd` 字面值。與 `path` 兩欄並列的理由見 {@link serializeEndpointContracts}。 */
  readonly cmd: string
  /** request body 的必填欄位，已排序。 */
  readonly requiredBodyFields: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

/** 路由的識別鍵。method 一起帶上，才不會讓同路徑不同 method 被誤認成同一支。 */
const routeKey = (method: string, path: string): string => `${method} ${path}`

/**
 * 每一個認證群組各自註冊了哪些路由。
 *
 * **分別組裝每一組**是唯一問得到「這支端點屬於哪一組」的方法：路由物件上沒有這個資訊，
 * 而群組成員關係只存在於 `routes.ts` 的 `.use()` 順序裡。
 */
const routeKeysByGroup = (
  dependencies: AppDependencies,
): readonly (readonly [AuthenticationGroupId, ReadonlySet<string>])[] =>
  AUTHENTICATION_GROUPS.map((group) => [
    group.id,
    new Set(group.build(dependencies).routes.map((route) => routeKey(route.method, route.path))),
  ])

/**
 * 取出 request body 的必填欄位與 `cmd` 字面值。
 *
 * 讀不到就拋例外而不是回 `null`：這裡是 §2「每個對外端點都必須宣告完整的 request schema」
 * 的執行點，缺一項就是缺一項，靜靜跳過等於把檢查關掉。
 */
const readRequestContract = (path: string, hooks: Record<string, unknown>): Omit<EndpointContract, 'authGroup'> => {
  const body: unknown = hooks['body']
  if (!isRecord(body)) {
    throw new Error(`${path} 沒有宣告 request body schema（§2）。前端會拿到一個空洞的型別，只能自己手寫 DTO。`)
  }

  const required: unknown = body['required']
  if (!isUnknownArray(required)) {
    throw new Error(`${path} 的 request body schema 沒有 required 欄位清單，形狀不像 t.Object(...)。`)
  }

  const properties: unknown = body['properties']
  const cmdSchema: unknown = isRecord(properties) ? properties['cmd'] : undefined
  const cmd: unknown = isRecord(cmdSchema) ? cmdSchema['const'] : undefined
  if (typeof cmd !== 'string') {
    throw new Error(
      `${path} 的 request body 沒有把 cmd 收窄成字面值（§1.3）。` +
        `應為 cmd: t.Literal('${toCommandCode(path)}')；沒有它，前端產生的 client 帶不出這支端點的指令名。`,
    )
  }

  const requiredBodyFields: string[] = []
  for (const field of required) {
    if (typeof field !== 'string') {
      throw new Error(`${path} 的 request body required 清單裡出現非字串項目。`)
    }
    requiredBodyFields.push(field)
  }

  return { path, cmd, requiredBodyFields: requiredBodyFields.toSorted() }
}

/**
 * 200 的 response schema 必須是 `envelope(...)` 的呼叫結果（§1.7）。
 *
 * 比對方式是 `allOf[0] === BaseResponse`——**同一個物件**，不是「長得一樣的物件」。
 * 這正是規範要的判準：手寫一份逐字相同的 `t.Object({ code, msg, errors, ... })` 也必須失敗，
 * 因為它是第二份 envelope 定義，改 envelope 時不會跟著改。
 */
const assertEnvelopeResponse = (path: string, hooks: Record<string, unknown>): void => {
  const response: unknown = hooks['response']
  if (!isRecord(response)) {
    throw new Error(`${path} 沒有宣告 response schema（§2）。缺 response schema 的端點在 OpenAPI 上是個空洞。`)
  }

  const success: unknown = response['200']
  if (!isRecord(success)) {
    throw new Error(`${path} 沒有宣告 200 的 response schema（§2）。`)
  }

  const allOf: unknown = success['allOf']
  if (!isUnknownArray(allOf) || allOf[0] !== BaseResponse) {
    throw new Error(
      `${path} 的 200 response 不是 envelope(...) 的產物（§1.7）。` +
        `請改成 response: { 200: envelope(<data schema>) }，不要自己組 t.Object({ code: ... })。`,
    )
  }
}

/**
 * 讀出全部端點的契約。
 *
 * @param dependencies 一般傳 `contractOnlyDependencies()`——本函式只讀路由宣告，不送請求。
 */
export const collectEndpointContracts = (dependencies: AppDependencies): readonly EndpointContract[] => {
  const app = buildApp(dependencies)
  const groups = routeKeysByGroup(dependencies)
  const contracts: EndpointContract[] = []
  const unattributed: string[] = []

  for (const route of app.routes) {
    const key = routeKey(route.method, route.path)

    if (INFRASTRUCTURE_ROUTES.has(key)) continue

    const owner = groups.find(([, keys]) => keys.has(key))
    if (owner === undefined) {
      unattributed.push(key)
      continue
    }

    if (route.method !== 'POST') {
      // §1.2：業務端點一律 POST。快照本身不記 method（恆為 POST，記一欄永遠相同的值只會讓
      // diff 變吵），但「恆為 POST」這件事必須有人守著，否則快照上看不出破例。
      throw new Error(`${key} 不是 POST（§1.2）。業務端點一律 POST，只有基礎設施端點不受此限。`)
    }

    const hooks: unknown = route.hooks
    if (!isRecord(hooks)) {
      throw new Error(`${key} 沒有任何 schema 宣告。`)
    }

    assertEnvelopeResponse(route.path, hooks)
    contracts.push({ authGroup: owner[0], ...readRequestContract(route.path, hooks) })
  }

  if (unattributed.length > 0) {
    throw new Error(
      `以下路由不屬於任何認證群組，也不在基礎設施端點清單內：\n  ${unattributed.join('\n  ')}\n` +
        '每支端點都必須落在某一個認證群組內（§1.9.2）——「沒有加驗證」不是一種表示公開的方式。' +
        '若這是新增的認證群組，請把它加進 app/routes.ts 的 AUTHENTICATION_GROUPS；' +
        '若這是新的基礎設施端點，請把它加進 app/endpoint-inventory.ts 的 INFRASTRUCTURE_ROUTES。',
    )
  }

  // 通用規範 §7.2：掃描型檢查必須先確認自己真的掃到東西。組裝點改名、群組被整包拿掉、
  // Elysia 換掉 `routes` 這個 API——這三種情況都會讓下面的比對變成「拿空清單比空快照」，
  // 而那看起來與真正通過一模一樣。
  if (contracts.length === 0) {
    throw new Error('沒有讀到任何端點。路由組裝點或 Elysia 的路由 API 可能已經變更，這不是「目前沒有端點」。')
  }

  return contracts
}

/**
 * 序列化成快照文字。
 *
 * **排序鍵是 `path`**（唯一且穩定），不是註冊順序：註冊順序是 `routes.ts` 的 `.use()` 排列，
 * 挪動一行 `.use()` 就會讓整份快照重排，於是每一次無關的整理都變成一段假 diff，
 * 而真正的契約變更就藏在那堆搬家裡。
 *
 * **每支端點一行、欄位以 `|` 分隔**，不用 JSON：JSON 的一支端點佔六行，改一個必填欄位在 diff 上
 * 是「一行紅、一行綠」還要往上找三行才知道是哪支端點；一行一支則是同一行左右對照，
 * 而且 `path` 與 `cmd` 就在同一行，「路徑改了但 `cmd` 沒改」是一眼看得到的不對稱。
 *
 * **不記 method**（恆為 `POST`，§1.2），理由見規範：記一欄永遠相同的值只會讓快照變大、diff 變吵。
 * **必填欄位包含 `rqTS`／`cmd`／`locale` 這三個基底欄位**，雖然它們目前每支端點都一樣——
 * 與 method 的差別在於「誰保證它一樣」：method 由框架的註冊方式保證，基底三欄則是每支端點
 * 自己 `...BaseRequest` 展開來的，漏展開就是漏展開，而那是一次靜默的契約破壞。
 *
 * 排序用**碼位比大小**而不是 `localeCompare`：後者的結果取決於執行環境的 ICU 版本與語系，
 * 於是「同一份程式碼在不同機器上產出不同順序的快照」是做得到的——而那個症狀會表現成
 * 「在我的機器上是綠的」，最後的處置通常是把這支測試關掉。
 */
const byCodePoint = (left: EndpointContract, right: EndpointContract): number => {
  if (left.path < right.path) return -1
  return left.path > right.path ? 1 : 0
}

export const serializeEndpointContracts = (contracts: readonly EndpointContract[]): string =>
  contracts
    .toSorted(byCodePoint)
    .map((contract) =>
      [contract.path, contract.cmd, contract.authGroup, contract.requiredBodyFields.join(',')].join(' | '),
    )
    .join('\n')
