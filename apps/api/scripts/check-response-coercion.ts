/**
 * 回應方向強制轉型欄位掃描：`modules/**​/*.routes.ts` 裡，**被 `response:` 引用到的 schema**，
 * 不得使用 Elysia 重新定義過的 `t.Integer`／`t.Number`／`t.Boolean`（可強制轉型版本），一律要改用
 * TypeBox 原生的 `Type.Integer`／`Type.Number`／`Type.Boolean`。
 *
 * ## 為什麼要擋：這件事已經真的發生過
 *
 * `shared/field-schemas.ts` 的 `Pagination` 檔頭寫得很清楚：Elysia 把 `t.Integer`／`t.Number`／
 * `t.Boolean` 重新定義成 `anyOf [string, integer]`（或對應型別），為的是讓 `?page=1` 這種字串輸入
 * 也能通過驗證並轉成數字——**這是為 request 方向設計的容錯**，回應方向不需要、也不該有。
 * `attendance-records.routes.ts` 的 `AccuracyMeters` 真的踩到這個坑：它是 Elysia 的 `t.Integer`，
 * 只用在**回應**（`accuracyMeters` 是後端自己算出來、寫回去的欄位，不是使用者輸入），後果是
 * OpenAPI 上這一欄變成 `string | integer`，前端 `gen:api` 產生的型別跟著是 `string | number`，
 * 而前端規範禁止對 API 欄位用 `Number(`（`check:number-cast`）——於是畫面上長出一支專門繞過這條
 * 禁令的怪函式。**失敗模式是靜默的**：型別檢查、`bun run ci` 全綠，OpenAPI 契約看起來也「能用」，
 * 只有前端規範被迫另開一個逃生口才看得出來這裡有問題。
 *
 * ## 判準：AST，不是正則，且刻意區分 `response:` 與 `body:`
 *
 * 純文字掃描分不出「這個 `t.Integer(` 在 `body` 底下」還是「在 `response` 底下」——同一個檔案裡
 * 兩種都合法存在，差別只在物件字面值裡的哪一個屬性名底下。因此走 TypeScript 的 AST
 * （`ts.createSourceFile`），不建 `ts.Program`（理由與 `check-attendance-recalc.ts`／
 * `check-audit-transaction.ts` 檔頭一致：這裡要問的是「程式碼長什麼樣子」，不是「這個識別字的型別
 * 是什麼」）。
 *
 * 兩階段：
 *
 * 1. 找出每一支 `.post(...)` 呼叫（本專案「一律 POST」，§1.2）的路由設定物件（呼叫的最後一個
 *    `ObjectLiteralExpression` 引數），取出它的 `response` 屬性——這就是規則的**定義域**：
 *    `body:` 底下不管長什麼樣都不掃，這是這支腳本刻意的邊界，不是漏掃（見下方「request 方向不受
 *    限制」）。
 * 2. `response` 屬性值是一個「狀態碼 → schema 運算式」的物件字面值（例如
 *    `{ 200: envelope(X), ...CommonFailureResponses }`）。對每一個項目（`PropertyAssignment`
 *    的 `.initializer`、`SpreadAssignment` 的 `.expression`，或 `ShorthandPropertyAssignment`
 *    的 `.name`）做**識別字追蹤（closure）**：
 *
 *    - 直接掃這段運算式子樹裡有沒有 `t.Integer(`／`t.Number(`／`t.Boolean(` 呼叫
 *      （callee 是 `t.Integer` 這一類 `PropertyAccessExpression`，物件識別字精確等於 `t`——本專案
 *      全部 `*.routes.ts` 一致把 Elysia 的型別工具匯入為 `t`，把 TypeBox 原生工具匯入為 `Type`，
 *      見任一 `*.routes.ts` 檔頭的 import）。
 *    - 收集這段子樹裡出現的**每一個識別字**（`PropertyAccessExpression` 只收 `.expression` 那一側，
 *      不收 `.name`，避免把 `Integer`／`username` 這類屬性名誤認成變數）。對每個識別字，如果能在
 *      **同一個檔案**的頂層 `const` 宣告裡找到它，就展開它的初始化運算式，對展開後的子樹重複同樣
 *      兩件事——直到沒有新的本檔常數可以展開為止（`AttendanceRecordDetailSchema` 引用
 *      `AccuracyMeters`、`AccuracyMeters` 是 `t.Integer(...)`，就是靠這一層展開才追得到）。
 *
 * **request 方向不受限制**：`body:` 底下用 `t.Integer` 是對的，那正是它存在的理由（見上方
 * field-schemas.ts 的引用）。這支腳本只從 `response:` 出發做識別字追蹤，`body:` 物件字面值本身
 * 從來不是任何一次追蹤的起點——一個常數如果只在 `body:` 出現、從未被 `response:` 直接或間接引用，
 * 永遠不會被納入掃描範圍，這是刻意的，不是遺漏。
 *
 * ## 抓不到什麼
 *
 * - **跨檔案引用的 schema**：識別字追蹤只認得到「本檔頂層 `const` 宣告」，`import` 進來的識別字
 *   （例如 `field-schemas.ts` 的 `Nullable`／`Uuid`／`Pagination`）在本檔裡沒有初始化運算式可以
 *   展開，因此不會被誤報，也追不進去看它內部乾不乾淨——`Pagination` 已經在 `field-schemas.ts`
 *   自己修好，這支腳本並不「知道」這件事，只是因為看不到它的定義，既不會抓到也不會誤判成違規。
 *   `field-schemas.ts` 本身不在 `modules/` 底下，也不會被這支腳本直接掃到。
 * - **動態組出來的 schema**：用迴圈、`.map()`、或執行期組出來的欄位物件，識別字追蹤只認得到
 *   「直接寫出來的 `const` 宣告」，組合出來的中介值不在追蹤範圍內。
 * - **`.post(...)` 的路由設定不是字面值物件、而是由外部函式回傳整包設定再展開**：本專案目前每一
 *   支端點都是把物件字面值直接寫在 `.post(path, handler, { ... })` 的第三個引數，這支腳本假設這個
 *   慣例成立；真的出現「先組好一個變數再展開」的寫法，這裡會找不到 `ObjectLiteralExpression`
 *   而略過，不會誤報，但也不會抓到裡面的問題。
 * - **把 Elysia 的 `t` 匯入成別的名字**（例如 `import { t as elysiaT } from 'elysia'`）：判準精確
 *   比對物件識別字文字是 `t`，改名之後這支腳本認不出來，是繼承自「一律讀原始碼字面」這個既有假設
 *   （與 `check-attendance-recalc.ts` 認 `attendanceRecords` 這個字面識別字同一種限制）。
 *
 * ## §7.2 兩層自我檢查
 *
 * 掃到 0 個 `response:` 宣告必須失敗（同 `check-attendance-recalc.ts`／`check-audit-transaction.ts`
 * 的理由：`modules/` 搬家、`*.routes.ts` 改名、`.post(` 呼叫形狀改變，都會讓這支腳本照跑、照綠、
 * 零命中，而「回應方向不得可強制轉型」這條規則就在沒有人察覺的情況下失效了）。另外用一份內建樣本
 * 驗證判斷邏輯本身，涵蓋兩種違規（`response` 直接使用 `t.Integer`；`response` 引用的本檔常數用了
 * `t.Number`）與兩種合法形狀（`response` 用 `Type.Integer`；`body` 用 `t.Integer`，且該常數從未被
 * `response` 引用）——這份樣本不依賴 repo 現況，即使有一天全專案的欄位都寫對了，這一項仍然證明得了
 * 腳本擋得住東西。
 *
 * 執行：`bun run check:response-coercion`（已串進 `bun run ci`，緊接在 `check:attendance-recalc`
 * 之後）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：腳本從哪個目錄被呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** 規則的定義域：端點的 `response:` 只可能宣告在業務模組的 `*.routes.ts` 裡。 */
const SCAN_ROOT = join(API_ROOT, 'src/modules')

/** Elysia 的型別工具在本專案一律匯入為這個名字（見任一 `*.routes.ts` 的 import）。 */
const ELYSIA_TYPE_NAMESPACE = 't'

/** 視為「可強制轉型」而回應方向禁用的方法名。 */
const COERCIBLE_METHOD_NAMES = new Set(['Integer', 'Number', 'Boolean'])

/** 路由註冊一律 `.post(...)`（§1.2），這是找路由設定物件的入口方法名。 */
const ROUTE_METHOD_NAME = 'post'

/** 一則違規。位置一律寫成 `專案相對路徑:行號:欄號`，讓人可以直接跳過去改（§7.2）。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly detail: string
}

/** 直接把整支腳本判為不可信並中止（同 `check-attendance-recalc.ts`／`check-audit-transaction.ts`）。 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 位置一律寫成 `apps/api` 相對路徑，與其餘 `check-*.ts` 同一種格式。 */
const repoPath = (absolutePath: string): string => relative(API_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 判斷邏輯（純函式，下面的自我檢查會拿它去跑內建樣本）
// ---------------------------------------------------------------------------

/** 是不是 `t.Integer(...)`／`t.Number(...)`／`t.Boolean(...)` 這一類呼叫。物件識別字精確比對
 * {@link ELYSIA_TYPE_NAMESPACE}，不比對 `Type.Integer` 這種 TypeBox 原生呼叫。 */
const isCoercibleCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === ELYSIA_TYPE_NAMESPACE &&
  COERCIBLE_METHOD_NAMES.has(node.expression.name.text)

/** 遞迴收集一顆子樹裡所有符合 {@link isCoercibleCall} 的呼叫節點。`PropertyAccessExpression`
 * 只往 `.expression` 遞迴，理由與 {@link collectIdentifierNames} 相同。 */
const collectCoercibleCalls = (node: ts.Node): ts.CallExpression[] => {
  const found: ts.CallExpression[] = []
  const visit = (current: ts.Node): void => {
    if (isCoercibleCall(current)) found.push(current)
    if (ts.isPropertyAccessExpression(current)) {
      visit(current.expression)
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

/** 遞迴收集一顆子樹裡所有識別字的文字。`PropertyAccessExpression` 只收 `.expression` 那一側，
 * 不收 `.name`——否則 `t.Integer(...)` 的 `Integer`、`row.username` 的 `username` 都會被誤認成
 * 「可能是本檔某個常數」去查表，雖然查不到時只是安靜地沒有命中，但這樣做的雜訊沒有意義。 */
const collectIdentifierNames = (node: ts.Node): Set<string> => {
  const names = new Set<string>()
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current)) {
      names.add(current.text)
      return
    }
    if (ts.isPropertyAccessExpression(current)) {
      visit(current.expression)
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return names
}

/** 本檔頂層 `const` 宣告：識別字 → 初始化運算式。只收檔案最外層的 `VariableStatement`
 * （`export` 與否不影響結構，`ExportModifier` 不改變 `VariableStatement` 本身），足以涵蓋
 * `*.routes.ts` 一貫把 schema 常數宣告在模組頂層的寫法。 */
const collectTopLevelConstDeclarations = (sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> => {
  const declarations = new Map<string, ts.Expression>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        declarations.set(declaration.name.text, declaration.initializer)
      }
    }
  }
  return declarations
}

/**
 * 對一段「schema 運算式」做識別字追蹤（closure），把沿路發現的違規收進 `violations`。
 *
 * @param chain 走到這裡沿路展開過的本檔常數名稱（由外往內），只用來組違規訊息，不影響判斷本身。
 *   空陣列代表這段運算式就是 `response:` 底下的字面值本身，不是展開某個常數展開出來的。
 * @param visited 已經展開過的常數名稱，避免同一個常數在同一次呼叫鏈裡被重複展開（理論上 schema
 *   常數不會互相循環引用，這裡只是防禦）。
 */
const evaluateSchemaExpression = (
  node: ts.Node,
  chain: readonly string[],
  localConsts: ReadonlyMap<string, ts.Expression>,
  visited: Set<string>,
  onViolation: (call: ts.CallExpression, chain: readonly string[]) => void,
): void => {
  for (const call of collectCoercibleCalls(node)) onViolation(call, chain)

  for (const name of collectIdentifierNames(node)) {
    if (visited.has(name)) continue
    const declaration = localConsts.get(name)
    if (declaration === undefined) continue // 抓不到：跨檔案引用或不是 const 宣告，見檔頭。
    visited.add(name)
    evaluateSchemaExpression(declaration, [...chain, name], localConsts, visited, onViolation)
  }
}

/** 是不是 `<something>.post(...)` 這種呼叫（§1.2「一律 POST」，路由註冊的唯一入口方法名）。 */
const isPostRouteCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === ROUTE_METHOD_NAME

/** 從 `.post(...)` 的引數裡找路由設定物件：從最後一個引數往前找第一個物件字面值
 * （本專案一貫的形狀是 `.post(path, handler, { body, response, detail })`，設定物件是最後一個
 * 引數；用「從尾端找第一個物件字面值」而不是硬性假設一定是第三個引數，多容忍一種寫法）。 */
const findRouteConfigObject = (call: ts.CallExpression): ts.ObjectLiteralExpression | undefined => {
  for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
    const argument = call.arguments[index]
    if (argument !== undefined && ts.isObjectLiteralExpression(argument)) return argument
  }
  return undefined
}

/** 從路由設定物件裡找 `response` 屬性（`PropertyAssignment`，名字是 `response`）。 */
const findResponseProperty = (config: ts.ObjectLiteralExpression): ts.PropertyAssignment | undefined =>
  config.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'response') ||
        (ts.isStringLiteral(property.name) && property.name.text === 'response')),
  )

/** `response` 物件字面值（`{ 200: envelope(X), ...Common }`）裡，每一個項目要拿去做識別字追蹤的
 * 起點運算式：`PropertyAssignment` 用它的值、`SpreadAssignment` 用被展開的來源、
 * `ShorthandPropertyAssignment` 用它自己的識別字。 */
const responseEntryExpressions = (responseObject: ts.ObjectLiteralExpression): ts.Expression[] => {
  const expressions: ts.Expression[] = []
  for (const property of responseObject.properties) {
    if (ts.isPropertyAssignment(property)) expressions.push(property.initializer)
    else if (ts.isSpreadAssignment(property)) expressions.push(property.expression)
    else if (ts.isShorthandPropertyAssignment(property)) expressions.push(property.name)
  }
  return expressions
}

/** 一個檔案的掃描結果：違規清單 ＋ 命中的 `response:` 宣告數（自我檢查要用後者）。 */
type FileScanResult = {
  readonly violations: readonly Violation[]
  readonly responseDeclarationCount: number
}

/** 掃單一檔案（或內建樣本字串）。 */
const scanSource = (code: string, file: string): FileScanResult => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const localConsts = collectTopLevelConstDeclarations(sourceFile)
  const violations: Violation[] = []
  // 同一個常數常被多支端點的 `response:` 共同引用（例如 `CommonFailureResponses`），
  // 展開後會落在同一個原始碼位置——用位置字串去重，避免同一處違規因為被多支端點引用而重複列出。
  const reportedPositions = new Set<string>()
  let responseDeclarationCount = 0

  const recordViolation = (call: ts.CallExpression, chain: readonly string[]): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile))
    const position = `${String(line + 1)}:${String(character + 1)}`
    if (reportedPositions.has(position)) return
    reportedPositions.add(position)

    const methodName = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : '?'
    const nativeReplacement = `Type.${methodName}`
    const viaText = chain.length === 0 ? 'response 直接使用' : `response 經由 ${chain.join(' → ')} 引用到的常數使用`

    violations.push({
      file,
      line: line + 1,
      column: character + 1,
      source: call.getText(sourceFile).split('\n')[0]?.trim() ?? '',
      detail: `${viaText}了 Elysia 的 t.${methodName}（可強制轉型），回應方向必須改用 TypeBox 原生的 ${nativeReplacement}`,
    })
  }

  const visit = (node: ts.Node): void => {
    if (isPostRouteCall(node)) {
      const config = findRouteConfigObject(node)
      const responseProperty = config === undefined ? undefined : findResponseProperty(config)
      if (responseProperty !== undefined && ts.isObjectLiteralExpression(responseProperty.initializer)) {
        responseDeclarationCount += 1
        for (const expression of responseEntryExpressions(responseProperty.initializer)) {
          evaluateSchemaExpression(expression, [], localConsts, new Set(), recordViolation)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { violations, responseDeclarationCount }
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有 `.ts` 檔，再由呼叫端篩 `.routes.ts`（含 `__tests__`：本掃描本來就不會
 * 命中測試檔——測試檔裡沒有 `.post(` 路由註冊——篩檔名只是為了不浪費時間解析用不到的檔案）。 */
const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return []

  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(path))
      continue
    }
    if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

const files = listFiles(SCAN_ROOT).filter((file) => file.endsWith('.routes.ts'))

const violations: Violation[] = []
let totalResponseDeclarationCount = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = scanSource(source, repoPath(file))
  violations.push(...result.violations)
  totalResponseDeclarationCount += result.responseDeclarationCount
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 內建樣本涵蓋四支「端點」，兩種違規、兩種合法形狀：
 *
 * 1. `valid-native`：`response` 用 `Type.Integer(...)`（TypeBox 原生）→ 合法。
 * 2. `valid-request-only`：`body` 用 `t.Integer(...)`，但這個常數從未被任何 `response` 引用
 *    （`response` 只回 `t.Null()`）→ 合法，證明 `body:` 底下的 `t.Integer` 真的不受這支腳本管。
 * 3. `invalid-direct`：`response` 直接寫 `t.Integer(...)` → 違規（不經任何常數，`chain` 為空）。
 * 4. `invalid-via-const`：`response` 引用本檔常數 `InvalidLocalConst`，該常數是 `t.Number(...)`
 *    → 違規（`chain` 長度 1，證明識別字追蹤真的有展開常數，不是只看字面值本身）。
 *
 * 預期：4 個 `response:` 宣告，2 則違規（3、4）。
 */
const SELF_TEST_SAMPLE = [
  "import { Elysia, t } from 'elysia'",
  "import { Type } from '@sinclair/typebox'",
  'const ValidResponseField = Type.Integer({ minimum: 0 })',
  'const InvalidLocalConst = t.Number({ minimum: -90 })',
  '',
  'const app = new Elysia()',
  "  .post('/self-test/valid-native', handler, {",
  '    body: t.Object({ page: t.Integer({ minimum: 1 }) }),',
  '    response: { 200: envelope(t.Object({ total: ValidResponseField })) },',
  '  })',
  "  .post('/self-test/valid-request-only', handler, {",
  '    body: t.Object({ count: t.Integer({ minimum: 0 }) }),',
  '    response: { 200: envelope(t.Null()) },',
  '  })',
  "  .post('/self-test/invalid-direct', handler, {",
  '    body: t.Object({}),',
  '    response: { 200: envelope(t.Object({ total: t.Integer({ minimum: 0 }) })) },',
  '  })',
  "  .post('/self-test/invalid-via-const', handler, {",
  '    body: t.Object({}),',
  '    response: { 200: envelope(t.Object({ latitude: InvalidLocalConst })) },',
  '  })',
].join('\n')

const SELF_TEST_EXPECTED_RESPONSE_DECLARATIONS = 4
const SELF_TEST_EXPECTED_VIOLATIONS = 2

const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個 *.routes.ts 檔案（${repoPath(SCAN_ROOT)}）：目錄可能搬家了，這次掃描等於沒跑`)
}

// 命中 0 個 response: 宣告必須失敗（§7.2 的核心要求，見檔頭）：modules/ 搬家、*.routes.ts 改名、
// .post( 呼叫形狀改變，都會讓這支腳本照跑、照綠、零命中，規則就在沒有人察覺的情況下失效了。
if (totalResponseDeclarationCount === 0) {
  selfCheckFailures.push(
    `${repoPath(SCAN_ROOT)} 底下的 *.routes.ts 找不到任何 response: 宣告：` +
      '規則的檢查對象消失了，這次掃描等於沒跑（也可能是找路由設定物件的邏輯已經失效）',
  )
}

const selfTestResult = scanSource(SELF_TEST_SAMPLE, '<self-test>')
if (selfTestResult.responseDeclarationCount !== SELF_TEST_EXPECTED_RESPONSE_DECLARATIONS) {
  selfCheckFailures.push(
    `內建樣本應找到 ${String(SELF_TEST_EXPECTED_RESPONSE_DECLARATIONS)} 個 response: 宣告，` +
      `實際 ${String(selfTestResult.responseDeclarationCount)} 個：response: 宣告的辨識邏輯已經失效`,
  )
}
if (selfTestResult.violations.length !== SELF_TEST_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `內建樣本應命中 ${String(SELF_TEST_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestResult.violations.length)} 則：識別字追蹤（含跨常數展開）的判斷邏輯已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort([
    '回應方向強制轉型掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `response: 底下不得使用 Elysia 可強制轉型的 t.Integer／t.Number／t.Boolean` +
        `（${String(violations.length)} 處違規）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：把這個欄位改用 TypeBox 原生的 Type.Integer／Type.Number／Type.Boolean（`import { Type }',
      "from '@sinclair/typebox'`）。如果同一個常數也被 body: 使用（同時服務請求與回應兩個方向），",
      '不要直接改掉共用常數——那會讓 request 方向失去容錯；改成宣告兩個常數，body 用 t.X 保留可強制',
      '轉型，response 另外用 Type.X，比照 apps/api/src/shared/field-schemas.ts 的 Pagination 檔頭，',
      '或 apps/api/src/modules/attendance/records/attendance-records.routes.ts 的 LatitudeResponse／',
      'LongitudeResponse／AccuracyMetersResponse 形狀。',
      '理由完整寫在 apps/api/scripts/check-response-coercion.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `回應方向強制轉型檢查通過：${String(files.length)} 個 *.routes.ts 檔案，` +
    `${String(totalResponseDeclarationCount)} 個 response: 宣告，全部沒有使用可強制轉型的欄位型別。\n`,
)
