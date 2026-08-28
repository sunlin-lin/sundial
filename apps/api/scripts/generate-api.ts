/**
 * `bun run gen:api`：由後端程式碼產出 API 契約與前端產生物（§1.7）。
 *
 * ```text
 * app/app.ts 的路由宣告（唯一真相）
 *   ├─▶ openapi.json                                  對外契約，機器可讀
 *   └─▶ apps/web/src/api/generated/
 *         ├─ api-types.ts    由 openapi.json 產生的 TypeScript 型別
 *         ├─ api-guard.ts    執行期形狀檢查（scripts/api-contract-guard.ts 的複本）
 *         └─ api-client.ts   每支端點一個函式，傳輸一律交給前端的統一 client
 * ```
 *
 * ## 三條硬要求，每一條都寫在這裡是因為它們很容易在日後被「順手」破壞
 *
 * 1. **不連資料庫、不啟動服務。** 本檔只 `buildApp(contractOnlyDependencies())` 讀路由宣告，
 *    不 `listen`、不 `fetch`、不讀 `.env`。理由是規範原文：前端開發者與 CI 只是要一份型別；
 *    若必須先起後端與 MariaDB 才能產生，這個指令會在新人的第一天失敗，
 *    結果是「跑不起來，先沿用舊型別」——契約單一來源等於沒有。
 * 2. **產生物不進版控**（`.gitignore` 已排除），**禁止手動修改**。改了下次重跑就沒了，
 *    而在那之前它會是一份「看起來已經對過了」的假契約。
 * 3. **產生的 client 一律走前端的統一 client**（前端規範 §3.1），不使用任何預設 fetcher。
 *    繞過統一 client 的請求會漏掉 token 附加、single-flight refresh、envelope 拆解與 `code` 分支，
 *    而且**在本機開發時完全看不出來**——refresh 那條路徑要等兩、三個小時後才走得到。
 *    本檔是唯一決定「產生的函式怎麼送出請求」的地方，因此那一行是寫死的。
 *
 * ## 為什麼 client 是自己產的，不是套現成的產生器
 *
 * 本系統的端點形狀被規範收得極窄：全部 `POST`、沒有路徑參數、沒有 query（§1.1、§1.2、§1.5），
 * request 是平鋪的 envelope、response 一律是 `envelope(dataSchema)`（§1.3）。
 * 現成產生器（openapi-fetch 之類）產出的是「處理所有 OpenAPI 可能性」的通用 client，
 * 它的 fetcher 是它自己的，而前端規範 §3.1 **禁止使用產生器的預設 fetcher**——
 * 要換掉它就得在產生器的擴充點裡繞，繞出來的東西比這裡的樣板長。
 * 型別本身仍然交給 `openapi-typescript`（那是純轉譯，沒有執行期行為）。
 */
import { writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// `@elysiajs/openapi` 與 `openapi-typescript` 都是 **devDependency**：只有這支建置期腳本用得到，
// 正式服務的組裝點與路由一個字都沒有 import 它們。放進 dependency 會讓兩支只在建置期跑的工具
// 跟著上正式環境。
import { toOpenAPISchema } from '@elysiajs/openapi'
import openapiTS, { astToString } from 'openapi-typescript'
import { buildApp } from '../src/app/app.ts'
import { contractOnlyDependencies } from '../src/app/contract-dependencies.ts'
import { collectEndpointContracts, type EndpointContract } from '../src/app/endpoint-inventory.ts'
import { BaseRequest } from '../src/shared/field-schemas.ts'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：從哪個目錄呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

const REPO_ROOT = resolve(API_ROOT, '../..')

const SPEC_FILE = join(REPO_ROOT, 'openapi.json')

/** 前端規範 §0.1 已經留好這個位置；目錄內容一律不進版控。 */
const GENERATED_DIR = join(REPO_ROOT, 'apps/web/src/api/generated')

/** 執行期形狀檢查的原始碼。複製而不是 import，理由寫在該檔檔頭（前端不得 import `apps/api`）。 */
const GUARD_SOURCE_FILE = join(API_ROOT, 'scripts/api-contract-guard.ts')

/**
 * OpenAPI 的 `info.version`。
 *
 * **刻意寫死成 `0.0.0` 而不是接上 package.json 或 git commit**：§1.6 的版本策略是「URL 不帶版本、
 * 不相容變更走兩步走」，API 本身沒有一個會遞增的版本號。放一個會變動的值進來，只會讓
 * `openapi.json` 每次重跑都不一樣，於是「這次產生物有沒有變」這個問題永遠答不出來。
 */
const SPEC_VERSION = '0.0.0'

const JSON_CONTENT_TYPE = 'application/json'

const REF_PREFIX = '#/components/schemas/'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 把 TypeBox 的內嵌 `$id` 提升成 `components.schemas`，並把裸名 `$ref` 改寫成 JSON Pointer。
 *
 * **為什麼需要這一步**：遞迴 schema（目前是權限樹的 `PermissionNode`）在 TypeBox 裡是
 * 「節點上掛 `$id`、子節點寫 `$ref: 'PermissionNode'`」。那是 JSON Schema 的寫法，
 * 但**不是合法的 OpenAPI `$ref`**（OpenAPI 要求 `$ref` 是 URI／JSON Pointer），
 * 於是 `openapi-typescript` 會把 `PermissionNode` 當成一個**檔案路徑**去開，然後以
 * 「`Can't resolve $ref: ENOENT ... /PermissionNode`」這種完全看不出成因的訊息中止
 *（訊息裡出現的是執行者的家目錄，沒有任何線索指向權限樹的 schema）。
 *
 * 這是**產生流程的一步，不是手改 spec**：輸入仍然只有路由宣告，改寫規則是機械的，
 * 每次重跑都會再做一次。
 */
const normalizeSchemaRefs = (node: unknown, schemas: Record<string, unknown>): unknown => {
  if (Array.isArray(node)) return node.map((item) => normalizeSchemaRefs(item, schemas))
  if (!isRecord(node)) return node

  const ref: unknown = node['$ref']
  if (typeof ref === 'string' && !ref.startsWith('#')) {
    return { $ref: `${REF_PREFIX}${ref}` }
  }

  const rewritten: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === '$id') continue
    rewritten[key] = normalizeSchemaRefs(value, schemas)
  }

  const id: unknown = node['$id']
  if (typeof id !== 'string') return rewritten

  const existing: unknown = schemas[id]
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(rewritten)) {
    // 同一個 `$id` 指到兩份不同的 schema：後蓋前會產出一份「其中一支端點的型別是錯的」契約，
    // 而且完全不會有任何警告。這種情況只可能是有人把兩個不同的 t.Object 標了同一個 $id。
    throw new Error(`schema 的 $id「${id}」被兩份不同的定義使用，無法合併成 components.schemas。`)
  }
  schemas[id] = rewritten

  return { $ref: `${REF_PREFIX}${id}` }
}

/**
 * requestBody 只保留 `application/json`。
 *
 * Elysia 的 OpenAPI 外掛會替每支端點列出三種 content type（`application/json`、
 * `application/x-www-form-urlencoded`、`multipart/form-data`），因為框架本身確實收得下那三種。
 * 但本系統的請求**只有 JSON**（§1.2、§1.5：一律 POST、參數一律走 body），統一 client 也只送 JSON。
 * 留著另外兩種的後果是產生的型別變成三個一模一樣的分支，而呼叫端可以挑到一個
 * 統一 client 永遠不會送出的形狀——那是一個編譯得過、跑起來一定不對的選項。
 */
const keepJsonRequestBodyOnly = (operation: Record<string, unknown>): void => {
  const requestBody: unknown = operation['requestBody']
  if (!isRecord(requestBody)) return

  const content: unknown = requestBody['content']
  if (!isRecord(content)) return

  const json: unknown = content[JSON_CONTENT_TYPE]
  if (json === undefined) return

  requestBody['content'] = { [JSON_CONTENT_TYPE]: json }
}

/** 產出完整的 OpenAPI 文件。 */
const buildOpenApiDocument = (): Record<string, unknown> => {
  const app = buildApp(contractOnlyDependencies())
  const { paths, components } = toOpenAPISchema(app)

  const schemas: Record<string, unknown> = isRecord(components['schemas']) ? { ...components['schemas'] } : {}
  const normalizedPaths: unknown = normalizeSchemaRefs(paths, schemas)
  if (!isRecord(normalizedPaths)) {
    throw new Error('OpenAPI 的 paths 不是物件，Elysia 的 OpenAPI 外掛輸出可能已經變更。')
  }

  for (const pathItem of Object.values(normalizedPaths)) {
    if (!isRecord(pathItem)) continue
    const operation: unknown = pathItem['post']
    if (isRecord(operation)) keepJsonRequestBodyOnly(operation)
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Sundial API',
      version: SPEC_VERSION,
      description:
        '由後端路由宣告產生（bun run gen:api，後端規範 §1.7）。禁止手改：這份檔案不進版控，改了下次重跑就沒了。',
    },
    paths: normalizedPaths,
    components: { schemas },
  }
}

// --- 前端 client 的樣板 -----------------------------------------------------

/** `/sessions/main/logout-all` → `sessionsMainLogoutAll`。 */
const toSymbolName = (path: string): string => {
  const words = path
    .split('/')
    .flatMap((segment) => segment.split('-'))
    .filter((word) => word.length > 0)
  return words.map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)).join('')
}

/** `/sessions/main/logout-all` → `SessionsMainLogoutAll`。 */
const toTypeName = (path: string): string => {
  const symbol = toSymbolName(path)
  return `${symbol.charAt(0).toUpperCase()}${symbol.slice(1)}`
}

/**
 * 取出某支端點 200 回應的 `data` schema。
 *
 * 走的是 `envelope(dataSchema)` 在 OpenAPI 上的固定形狀（§1.7）：
 * `allOf` [ `BaseResponse`, `{ data: ... }` ]。形狀不符就中止而不是回一個空 schema——
 * 空 schema 會讓那支端點的執行期檢查變成「什麼都放行」，而它看起來與正常運作一模一樣。
 */
const readDataSchema = (document: Record<string, unknown>, path: string): unknown => {
  const paths: unknown = document['paths']
  const pathItem: unknown = isRecord(paths) ? paths[path] : undefined
  const operation: unknown = isRecord(pathItem) ? pathItem['post'] : undefined
  const responses: unknown = isRecord(operation) ? operation['responses'] : undefined
  const success: unknown = isRecord(responses) ? responses['200'] : undefined
  const content: unknown = isRecord(success) ? success['content'] : undefined
  const json: unknown = isRecord(content) ? content[JSON_CONTENT_TYPE] : undefined
  const schema: unknown = isRecord(json) ? json['schema'] : undefined
  const allOf: unknown = isRecord(schema) ? schema['allOf'] : undefined
  const dataMember: unknown = Array.isArray(allOf) ? allOf[1] : undefined
  const properties: unknown = isRecord(dataMember) ? dataMember['properties'] : undefined
  const data: unknown = isRecord(properties) ? properties['data'] : undefined

  if (data === undefined) {
    throw new Error(`${path} 的 200 回應不是 envelope(...) 在 OpenAPI 上的形狀，取不出 data schema。`)
  }
  return data
}

/**
 * 執行期形狀檢查看得懂的關鍵字。其餘一律不進產生物。
 *
 * 這一份與 `api-contract-guard.ts` 實際處理的關鍵字**必須是同一組**：多留的關鍵字是進到
 * 瀏覽器裡卻沒有人讀的位元組，少留的關鍵字則會讓檢查安靜地放寬（例如把 `required` 拿掉，
 * 那支端點就再也檢查不出缺欄位）。
 */
const SHAPE_KEYWORDS: ReadonlySet<string> = new Set([
  '$ref',
  'anyOf',
  'allOf',
  'const',
  'type',
  'properties',
  'required',
  'items',
])

/**
 * 把 schema 削成只剩形狀。
 *
 * `pattern`／`minLength`／`maxLength`／`minimum`／`format`／`default`／`description` 這些
 * **值的約束**全部丟掉：前端這一層要回答的是「形狀對不對」，值的合法性由後端驗（§2），
 * 前端再驗一次只會出現「後端放行、前端卻把正常回應判成壞掉」這種永遠查不出來的狀況
 *（理由完整寫在 `api-contract-guard.ts` 檔頭）。
 *
 * 順帶的效果是產生物小得多——這些 schema 是**會被打包進瀏覽器**的位元組，
 * 而其中每一個 `pattern` 字串都不會有任何一行程式碼去讀它。
 */
const pruneToShape = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(pruneToShape)
  if (!isRecord(node)) return node

  const pruned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (!SHAPE_KEYWORDS.has(key)) continue

    if (key === 'const' || key === 'required') {
      // 這兩個的值是**資料**（欄位名清單、字面值本身），不是巢狀 schema。往下削會把它們清空，
      // 而清空之後檢查照跑、只是什麼都不擋——那正是「一條永遠是綠的檢查」。
      pruned[key] = value
    } else if (key === 'properties') {
      pruned[key] = pruneSchemaMap(value)
    } else {
      pruned[key] = pruneToShape(value)
    }
  }
  return pruned
}

/**
 * 削「名字 → schema」這種對應表（`properties`、`components.schemas`）。
 *
 * **必須與 {@link pruneToShape} 分開**：那一層的 key 是欄位名／schema 名，不是 JSON Schema
 * 關鍵字。把它交給 `pruneToShape` 的話，每一個名字都會因為「不在關鍵字白名單裡」而被丟掉，
 * 產出一個 `properties: {}`——形狀檢查於是對每一個欄位都放行，而它看起來與正常運作一模一樣。
 */
const pruneSchemaMap = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return {}
  const map: Record<string, unknown> = {}
  for (const [name, schema] of Object.entries(value)) map[name] = pruneToShape(schema)
  return map
}

/**
 * 削完之後的自我檢查（通用規範 §7.2）。
 *
 * 上面兩個函式的差別很細，而寫錯的表現是「產生成功、檢查失效」——沒有任何錯誤訊息，
 * 只是每支端點的執行期檢查都變成一律放行。這支斷言把那件事變成產生階段的紅燈：
 * **每一個宣告了 `required` 的物件 schema，那些欄位都必須在 `properties` 裡找得到**。
 */
const assertShapeSurvivedPruning = (label: string, node: unknown): void => {
  if (Array.isArray(node)) {
    for (const item of node) assertShapeSurvivedPruning(label, item)
    return
  }
  if (!isRecord(node)) return

  const required: unknown = node['required']
  const properties: unknown = node['properties']
  if (Array.isArray(required) && required.length > 0) {
    for (const field of required) {
      if (typeof field !== 'string') continue
      if (!isRecord(properties) || !Object.hasOwn(properties, field)) {
        throw new Error(`${label}：削減 schema 之後必填欄位「${field}」在 properties 裡不見了，形狀檢查已經失效。`)
      }
    }
  }

  for (const value of Object.values(node)) assertShapeSurvivedPruning(label, value)
}

const clientHeader = (): string => `/**
 * **產生物，禁止手動修改**（後端規範 §1.7、前端規範 §3.2）。
 * 由 \`bun run gen:api\` 從後端路由宣告產生；改了下次重跑就沒了。
 *
 * 每支端點一個函式，**簽章一律只有一個參數**（那包業務欄位）：本系統的端點沒有路徑參數、
 * 沒有 query（後端規範 §1.1、§1.5），所以不會有「第一個參數是 id、第二個是 options」
 * 這種因端點而異的簽章。
 *
 * envelope 的三個基底欄位（\`rqTS\`／\`cmd\`／\`locale\`）**不在參數裡**：\`cmd\` 由本檔帶入，
 * 另外兩個由統一 client 補上（前端規範 §3.1，頁面程式碼不得自己組這三個欄位）。
 *
 * 傳輸一律交給 \`shared/api/client.ts\`，不使用任何預設 fetcher（前端規範 §3.1）。
 */
import { callApi } from '../../shared/api/client.ts'
import { contractDataReader, type ContractSchemaDefinitions } from './api-guard.ts'
import type { paths } from './api-types.ts'
`

/**
 * 基底三欄的欄位名，**由後端的 `BaseRequest` 推導**。
 *
 * 不在這裡寫死 `'rqTS' | 'cmd' | 'locale'`：寫死就是第二份真相，基底欄位增減時前端的
 * 呼叫參數型別會靜靜地與實際送出的 body 不一致（多的那一欄變成呼叫端必須自己填，
 * 而統一 client 其實已經填了）。
 */
const baseRequestFieldUnion = (): string =>
  Object.keys(BaseRequest)
    .map((field) => `'${field}'`)
    .join(' | ')

const endpointSection = (contract: EndpointContract, dataSchemaKey: string): string => {
  const typeName = toTypeName(contract.path)
  const symbol = toSymbolName(contract.path)
  const operation = `paths['${contract.path}']['post']`

  return `/** \`POST ${contract.path}\` 的業務欄位（已去掉由 client 自動補上的基底三欄）。 */
export type ${typeName}Input = Omit<
  ${operation}['requestBody']['content']['application/json'],
  BaseRequestField
>

/** \`POST ${contract.path}\` 成功回應的 \`data\`。 */
export type ${typeName}Data = ${operation}['responses'][200]['content']['application/json']['data']

/** 認證群組：${contract.authGroup}（憑證由統一 client 附上，不進 body，後端規範 §1.5）。 */
export const ${symbol} = (input: ${typeName}Input): Promise<${typeName}Data> =>
  callApi(
    '${contract.cmd}',
    '${contract.path}',
    input,
    contractDataReader<${typeName}Data>(DATA_SCHEMAS['${dataSchemaKey}'], SCHEMA_DEFINITIONS),
  )
`
}

const buildClientSource = (document: Record<string, unknown>, contracts: readonly EndpointContract[]): string => {
  const components: unknown = document['components']
  const schemas: unknown = isRecord(components) ? components['schemas'] : {}

  // 逐項削，不是把整個 `components.schemas` 丟進 `pruneToShape`：那一層的 key 是 schema 的**名字**
  //（`PermissionNode`），不是關鍵字，整包削會把每一個定義連名字一起丟掉，
  // 而結果是一個空的 `$ref` 解析表——檢查照跑，只是所有 `$ref` 都解析不到而一律放行。
  const definitions = pruneSchemaMap(schemas)
  assertShapeSurvivedPruning('components.schemas', definitions)

  const dataSchemas: Record<string, unknown> = {}
  for (const contract of contracts) {
    const dataSchema = pruneToShape(readDataSchema(document, contract.path))
    assertShapeSurvivedPruning(contract.path, dataSchema)
    dataSchemas[contract.cmd] = dataSchema
  }

  const sections = contracts.map((contract) => endpointSection(contract, contract.cmd))

  return [
    clientHeader(),
    `/** envelope 的基底欄位名（後端 \`shared/field-schemas.ts\` 的 \`BaseRequest\`）。 */`,
    `type BaseRequestField = ${baseRequestFieldUnion()}`,
    '',
    `/** \`$ref\` 的解析對象（目前只有遞迴 schema 會用到）。 */`,
    `const SCHEMA_DEFINITIONS: ContractSchemaDefinitions = ${JSON.stringify(definitions, null, 2)}`,
    '',
    `/** 每支端點成功回應的 \`data\` schema，供執行期形狀檢查使用（見 api-guard.ts 檔頭）。 */`,
    `const DATA_SCHEMAS: Readonly<Record<string, unknown>> = ${JSON.stringify(dataSchemas, null, 2)}`,
    '',
    ...sections,
  ].join('\n')
}

// --- 執行 -------------------------------------------------------------------

const writeGenerated = (fileName: string, content: string): void => {
  const target = join(GENERATED_DIR, fileName)
  writeFileSync(target, content, 'utf8')
  console.log(`  ${relative(REPO_ROOT, target).replaceAll('\\', '/')}`)
}

const document = buildOpenApiDocument()
const contracts = collectEndpointContracts(contractOnlyDependencies())

writeFileSync(SPEC_FILE, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

console.log(`已產生 ${String(contracts.length)} 支端點的契約（未連線資料庫、未啟動服務）：`)
console.log(`  ${relative(REPO_ROOT, SPEC_FILE).replaceAll('\\', '/')}`)

// **型別的輸入是剛寫出來的 `openapi.json`，不是記憶體裡那份物件**（§1.7 的鏈：
// 「輸出 openapi.json → 由該檔產生前端型別與 API client」）。差別不是形式上的：
// 讀檔案代表前端型別與那份對外契約檔**必然一致**，不會出現「spec 檔是舊的、型別是新的」；
// 而 spec 檔本身有問題（序列化壞掉、$ref 沒接上）時，錯誤會在這一步就爆，
// 而不是等到有人拿那份 spec 去餵別的工具才發現。
const types = astToString(await openapiTS(pathToFileURL(SPEC_FILE)))
writeGenerated('api-types.ts', types)

// 形狀檢查器：原始碼原封不動複製過去（見 `api-contract-guard.ts` 檔頭）。
const guardSource = await Bun.file(GUARD_SOURCE_FILE).text()
writeGenerated('api-guard.ts', guardSource)

writeGenerated('api-client.ts', buildClientSource(document, contracts))
