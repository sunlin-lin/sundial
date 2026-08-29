/**
 * N+1 掃描：資料庫查詢禁止「先查一批、再對每一筆各查一次」。
 *
 * 使用者原話：「資料庫的搜尋都不能用 N+1 方式，就是不能在 SQL 用迴圈，而必須要將資料
 * 蒐集完，一次搜尋。」落成機械判準就是：**迴圈裡不得出現資料庫呼叫的 `await`**。正確作法
 * 一律是把要查的鍵先蒐集成陣列，用 `WHERE ... IN (...)` 一次查完，再在記憶體裡用
 * `Map` 對應回去（`db/dev-standards-backend.md` §4.5 已有這條規則與範例，本腳本是它的
 * 自動化落地）。
 *
 * ## 為什麼 `Promise.all(arr.map(async ...))` 也算違規，不是比較快的合法寫法
 *
 * `Promise.all` 讓 N 個查詢並行送出，看起來比循序快，但它仍然是 **N 次資料庫往返、
 * N 個連線池 slot**。資料量一大，症狀從「這支端點比較慢」變成「連線池被這一支端點的
 * N 個查詢佔滿，別的請求開始逾時」——受害的是完全無關的另一支端點，而且日誌上看到的
 * 只有「連線逾時」，查不到是哪一支端點的迴圈造成的。這比循序 N+1 更危險，因為它更難查，
 * 因此本腳本把它與循序迴圈當成**同一條規則**的兩種寫法，不是分開處理的兩個問題。
 *
 * ## 判準：AST，不是正則（理由與 `check-audit-transaction.ts` 相同）
 *
 * 「這個 await 在不在迴圈體內」需要沿 parent 鏈往上走到最近的函式邊界，正則做不到
 * ——巢狀深度、換行、縮排在每個呼叫點都不同。因此走 TypeScript 的 AST
 * （`ts.createSourceFile`，只解語法不建 `ts.Program`，理由同上述腳本檔頭）。
 *
 * 本腳本抓四種形狀：
 * 1. `for`／`for...of`／`for...in`／`while`／`do...while` 迴圈體內（不跨函式邊界）有資料庫呼叫的 `await`。
 * 2. `.forEach(async (x) => { ...await 資料庫呼叫... })`——這個形狀還額外有「不會被 await」的 bug，
 *    但本腳本只管 N+1 那一半。
 * 3. `.map(...)`／`.flatMap(async ...)` 的 async 回呼裡有資料庫呼叫的 `await`（不論外層有沒有包
 *    `Promise.all`——沒包的話是一組不會被等待的懸置 Promise，一樣是 N 次往返，一樣違規）。
 * 4. 遞迴函式（具名的 `function` 宣告，或指派給具名變數的 `const x = async (...) => ...`）：
 *    函式本體內同時出現「呼叫自己」與「資料庫呼叫的 await」——每一層遞迴各查一次的形狀。
 *
 * ## 「是不是資料庫呼叫」怎麼判，以及這個判準抓不到什麼
 *
 * 三層判準，由嚴到寬：
 *
 * (A) **呼叫的識別字是從本檔案內某個路徑以 `.repository.ts` 結尾的模組 import 進來的。**
 *     這是最可靠的一層：本專案的資料存取一律集中在 `*.repository.ts`（§0.2 的檔名白名單），
 *     import 路徑抓得到就幾乎不會誤判。
 * (B) **呼叫是 `<運算式>.<method>(...)` 的形態，`method` 是 drizzle 查詢建構子
 *     （`select`／`selectDistinct`／`selectFrom`／`selectDistinctFrom`／`insert`／`update`／`delete`），
 *     且接收者（含鏈式呼叫再往前追一層）的文字命中 `db`／`tx`／`trx`／`runner`
 *     （含 `context.db`、`new TenantDatabase(...)` 這種寫法）。** 這一層抓的是 `*.repository.ts`
 *     檔案內部自己組查詢的迴圈，不依賴 import。
 * (C) **呼叫的識別字有從別的模組 import 進來，且名字以 `find`／`list`／`insert`／`update`／
 *     `delete`／`select`／`count` 開頭（後面接大寫字母，例如 `findOwnerById`）。** 這一層補
 *     (A) 抓不到的情況：資料庫背後的函式是跨模組經 `index.ts` 出口匯出的 service（例如
 *     `listPermissionCodes`），import 路徑看不出 `.repository.ts`，只能靠命名慣例補位。
 *
 * **這個判準抓不到什麼（誠實列出，不假裝完備）：**
 * - **跨函式的間接呼叫**：迴圈裡呼叫的是一個本檔案自己定義的 helper（例如
 *   `for (const x of xs) { await processOne(x) }`），而 `processOne` 內部才真的查資料庫。
 *   本腳本只看單一檔案的語法樹，不建呼叫圖，抓不到「helper 內部藏著資料庫呼叫」——
 *   `regulatory-sync.run.service.ts` 的 `executeMultiVersionSync` 迴圈呼叫 `createOneVersion`
 *   正是這種形狀，但那一段是刻意的（見稽核報告），不需要被抓到；反過來如果哪天有人寫出
 *   真正違規的同一種形狀，本腳本一樣看不見，這是已知的死角。
 * - **透過變數間接持有的函式參照**（`const fn = findEmployeeById; ...await fn(...)`）：
 *   呼叫點的識別字是 `fn`，不在任何一層判準的名單裡。
 * - **同名遮蔽**：函式名字剛好與外層某個無關函式相同時，(D) 的自我呼叫判斷可能誤判或漏判
 *   （只比對識別字文字，不做作用域解析）。
 * - **動態 import、`db.query.*`（relational API，§4.6 已另外禁止）之外的其他存取資料庫的管道**
 *   （例如原生 SQL 字串、其他 ORM 呼叫）不在判準之內。
 * - (C) 的命名慣例判準本身有偽陽性風險：任何**被 import** 且名字剛好以那七個動詞開頭的
 *   純函式（例如未來新增一個 `findMaxOf(a, b)` 這種零 IO 的工具函式）若被放進迴圈，會被
 *   誤判為違規。這是刻意的取捨（§7.1／§7.6：偽陽性的代價是「加一行豁免註解」，
 *   偽陰性的代價是「規則等於不存在」，兩者不對等）。
 *
 * ## 豁免機制：必須留下痕跡，沒有理由的豁免視為違規
 *
 * 真正需要迴圈的情況存在（例如「對固定的九個資料集各同步一次」——次數與資料量無關，
 * 不是「一批資料的逐筆查詢」）。豁免寫法是在**觸發違規的那一行，或正上方一行**加上
 * `// n-plus-one-ok: <理由>`。**冒號後面沒有非空白內容的豁免，視為違規**（等於沒寫理由），
 * 訊息會明確指出「豁免缺理由」。本腳本另外統計整個掃描範圍內 `n-plus-one-ok:` 標記的
 * 出現次數並印出來——豁免的數量本身必須是看得見的，不能無聲無息地增加。
 *
 * ## 定義域：`apps/api/src`，排除 `__tests__` 目錄與 `*.test.ts`
 *
 * 測試檔裡「造測試資料逐筆 insert」不是本規則要抓的形狀——那是一次性的測試前置作業，
 * 不是伺服器在服務請求時的查詢路徑，套用同一條規則只會逼每個測試檔都加一行豁免，
 * 讓豁免的訊噪比失去意義。**已知代價**：如果有人在測試以外、但功能等同「共用測試輔助檔」
 * 的地方（例如某個被大量呼叫的 seed 工具）寫出真正的 N+1，只要它不落在 `__tests__` 或
 * `*.test.ts`，仍然會被本腳本抓到；只有真正的測試檔本身被排除。
 *
 * ## §7.2 掃描器自我檢查
 *
 * 掃到 0 個檔案必須失敗（目錄搬家、glob 寫錯）。另外用內建樣本驗證判斷邏輯本身
 * （4 種違規形狀＋1 種「豁免缺理由仍算違規」＋3 種合法形狀，含一個「有豁免且理由完整」
 * 的樣本），這一層擋的是「判斷邏輯本身壞掉」，與「掃描對象消失」是不同的失敗模式。
 *
 * 執行：`bun run check:n-plus-one`（已串進 `bun run ci`，緊接在 `check:migration-journal` 之後）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導，理由與 `check-audit-transaction.ts` 相同。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** 規則的定義域：整個後端原始碼（排除測試，見檔頭）。 */
const SCAN_ROOT = join(API_ROOT, 'src')

/** drizzle 查詢建構子方法名（判準 B）。 */
const DB_BUILDER_METHODS = new Set([
  'select',
  'selectDistinct',
  'selectFrom',
  'selectDistinctFrom',
  'insert',
  'update',
  'delete',
])

/** 判準 B 的接收者提示：文字結尾命中 db／tx／trx／runner（含 `context.db`、`new TenantDatabase(...)`）。 */
const DB_RECEIVER_HINT = /(^|[.(]|new\s)(TenantDatabase|db|tx|trx|runner)\b/i

/** 判準 A／C 共用的動詞前綴（後面必須接大寫字母，避免撞到 `updateProfile` 以外的一般英文字）。 */
const DB_VERB_PREFIX = /^(find|list|insert|update|delete|select|count)[A-Z]/

/**
 * 豁免標記。冒號整段是選擇性的（`(?:...)?`），因為「完全沒寫冒號」與「寫了冒號但理由是空的」
 * 是同一種缺陷（沒有理由），必須被同一段邏輯抓到，不能因為沒有冒號就被判定成「根本不是豁免標記」
 * 而漏算進豁免次數統計。
 */
const EXEMPTION_PATTERN = /n-plus-one-ok(?:\s*:\s*(.*))?/

type ViolationKind = 'loop-body' | 'foreach-async' | 'map-async' | 'recursive'

type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly kind: ViolationKind
  readonly source: string
  readonly detail: string
}

/** 直接把整支腳本判為不可信並中止（同 `check-audit-transaction.ts`）。 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

const repoPath = (absolutePath: string): string => relative(API_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 判斷邏輯（純函式，下面的自我檢查會拿它去跑內建樣本）
// ---------------------------------------------------------------------------

const isLoopStatement = (node: ts.Node): node is ts.IterationStatement =>
  ts.isForStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node)

const isFunctionBoundary = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node)

/** 收集本檔案內「從 `*.repository.ts` import 進來的名字」與「全部 import 進來的名字」。 */
const collectImports = (sourceFile: ts.SourceFile): { repositoryNames: Set<string>; allImportedNames: Set<string> } => {
  const repositoryNames = new Set<string>()
  const allImportedNames = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause === undefined || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue

    for (const element of clause.namedBindings.elements) {
      const localName = element.name.text
      allImportedNames.add(localName)
      if (specifier.endsWith('.repository.ts')) repositoryNames.add(localName)
    }
  }

  return { repositoryNames, allImportedNames }
}

/** 判準 A／C：呼叫的識別字（非屬性存取）是不是資料庫呼叫。 */
const isDbCallIdentifier = (
  name: string,
  repositoryNames: ReadonlySet<string>,
  allImportedNames: ReadonlySet<string>,
): boolean => repositoryNames.has(name) || (allImportedNames.has(name) && DB_VERB_PREFIX.test(name))

/**
 * 判準 B：`<expr>.<method>(...)` 鏈式呼叫裡有沒有一層是資料庫查詢建構子呼叫。
 * 沿著 `expression` 往內遞迴，因此 `db.select(...).from(...).where(...).limit(1).for('update')`
 * 這種鏈式呼叫，不管檢查的是鏈上哪一個 `CallExpression`，都能找到最底層的 `db.select(`。
 */
const chainHasDbBuilderCall = (node: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text
      const receiverText = node.expression.expression.getText(sourceFile)
      if (DB_BUILDER_METHODS.has(methodName) && DB_RECEIVER_HINT.test(receiverText)) return true
      return chainHasDbBuilderCall(node.expression.expression, sourceFile)
    }
    return false
  }
  if (ts.isPropertyAccessExpression(node)) return chainHasDbBuilderCall(node.expression, sourceFile)
  return false
}

/** 一次呼叫是不是資料庫呼叫：三層判準的組合（A／B／C）。 */
const isDbCall = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  repositoryNames: ReadonlySet<string>,
  allImportedNames: ReadonlySet<string>,
): boolean => {
  if (ts.isIdentifier(call.expression))
    return isDbCallIdentifier(call.expression.text, repositoryNames, allImportedNames)
  return chainHasDbBuilderCall(call, sourceFile)
}

/** 拆掉 `await`／括號，取得真正被呼叫的 `CallExpression`（找不到回 `null`）。 */
const unwrapAwaitedCall = (awaitExpr: ts.AwaitExpression): ts.CallExpression | null => {
  let expr: ts.Expression = awaitExpr.expression
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression
  return ts.isCallExpression(expr) ? expr : null
}

/** `.forEach(`／`.map(`／`.flatMap(` 呼叫的第一個引數是不是 async 函式，是的話回傳它。 */
const asyncCallbackOf = (
  call: ts.CallExpression,
  methodNames: readonly string[],
): ts.FunctionLikeDeclaration | null => {
  if (!ts.isPropertyAccessExpression(call.expression)) return null
  if (!methodNames.includes(call.expression.name.text)) return null
  const callback = call.arguments[0]
  if (callback === undefined) return null
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null
  return callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true ? callback : null
}

const EXEMPTION_CHECK_NODES = (
  nodes: readonly ts.Node[],
  sourceFile: ts.SourceFile,
): { exempted: boolean; missingReason: boolean } => {
  const lines = sourceFile.text.split('\n')
  let sawMarker = false
  for (const node of nodes) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const candidates = [lines[line] ?? '', line > 0 ? (lines[line - 1] ?? '') : '']
    for (const candidate of candidates) {
      const match = EXEMPTION_PATTERN.exec(candidate)
      if (match === null) continue
      sawMarker = true
      if ((match[1] ?? '').trim().length > 0) return { exempted: true, missingReason: false }
    }
  }
  return { exempted: false, missingReason: sawMarker }
}

/** 一個檔案的掃描結果：違規清單、豁免標記出現次數（無論理由是否完整）。 */
type FileScanResult = {
  readonly violations: readonly Violation[]
  readonly exemptionMarkerCount: number
}

const scanSource = (code: string, file: string): FileScanResult => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const { repositoryNames, allImportedNames } = collectImports(sourceFile)
  const violations: Violation[] = []

  const locate = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const sourceTextOf = (node: ts.Node) => node.getText(sourceFile).split('\n')[0]?.trim() ?? ''

  const record = (node: ts.Node, kind: ViolationKind, detail: string): void => {
    const { line, character } = locate(node)
    violations.push({ file, line: line + 1, column: character + 1, kind, source: sourceTextOf(node), detail })
  }

  const dbCall = (call: ts.CallExpression): boolean => isDbCall(call, sourceFile, repositoryNames, allImportedNames)

  // --- 形狀 1：迴圈體內（不跨函式邊界）有資料庫呼叫的 await ---
  const checkLoopBody = (awaitExpr: ts.AwaitExpression, call: ts.CallExpression): void => {
    let current: ts.Node = awaitExpr
    let loop: ts.IterationStatement | null = null
    while (true) {
      const parent: ts.Node | undefined = current.parent
      if (parent === undefined || isFunctionBoundary(parent)) break
      if (isLoopStatement(parent)) {
        loop = parent
        break
      }
      current = parent
    }
    if (loop === null) return
    const check = EXEMPTION_CHECK_NODES([loop, awaitExpr], sourceFile)
    if (check.exempted) return
    record(
      awaitExpr,
      'loop-body',
      check.missingReason
        ? `迴圈內對資料庫的逐筆查詢：豁免標記缺理由（n-plus-one-ok: 後面必須寫原因），視為違規`
        : `迴圈內出現資料庫呼叫的 await：${sourceTextOf(call)}。正確作法是先蒐集鍵值陣列，` +
            '用單一 `WHERE ... IN (...)` 查詢一次撈完，再在記憶體用 Map 對應回去（§4.5）',
    )
  }

  // --- 形狀 2／3：.forEach(async ...) 與 .map/.flatMap(async ...) ---
  //
  // **刻意不要求 db 呼叫一定包在 `await` 裡**：`.map(async (x) => findX(x))`（concise body，
  // 沒有寫 `await` 兩個字）與 `.map(async (x) => { return await findX(x) })` 是同一件事
  // ——回呼本身是 async 函式，回傳值天生就是 Promise，外層 `Promise.all` 等的是那個 Promise，
  // 不是等 `await` 這個關鍵字。只認 `AwaitExpression` 會讓最常見的簡寫（沒有 `await` 兩個字）
  // 整批漏判，那正是「偽陰性」的死角，比多繞一層判斷的成本高得多。
  const checkAsyncCallbackDbAwait = (
    outerCall: ts.CallExpression,
    callback: ts.FunctionLikeDeclaration,
    kind: ViolationKind,
  ): void => {
    let found: { triggerNode: ts.Node; call: ts.CallExpression } | null = null
    const visit = (node: ts.Node): void => {
      if (found !== null) return
      // 不跨進巢狀的函式邊界，理由與迴圈那一支相同：巢狀函式若不是立即執行，
      // 裡面的呼叫不屬於這一次回呼的同步範圍。
      if (isFunctionBoundary(node) && node !== callback) return
      if (ts.isAwaitExpression(node)) {
        const call = unwrapAwaitedCall(node)
        if (call !== null && dbCall(call)) {
          found = { triggerNode: node, call }
          return
        }
      }
      if (ts.isCallExpression(node) && dbCall(node)) {
        found = { triggerNode: node, call: node }
        return
      }
      ts.forEachChild(node, visit)
    }
    if (callback.body !== undefined) visit(callback.body)
    if (found === null) return

    const { triggerNode: awaitExpr, call } = found
    const check = EXEMPTION_CHECK_NODES([outerCall, awaitExpr], sourceFile)
    if (check.exempted) return

    const methodText = ts.isPropertyAccessExpression(outerCall.expression) ? outerCall.expression.name.text : '?'
    if (check.missingReason) {
      record(awaitExpr, kind, `${methodText}(async ...) 內含資料庫查詢：豁免標記缺理由，視為違規`)
      return
    }
    if (kind === 'foreach-async') {
      record(
        awaitExpr,
        kind,
        `.forEach(async ...) 內含資料庫呼叫的 await（${sourceTextOf(call)}）：` +
          'forEach 不會等待這些 Promise，而且每一筆各發一次查詢，是 N+1 的一種寫法（§4.5）',
      )
      return
    }
    record(
      awaitExpr,
      kind,
      `.${methodText}(async ...) 內含資料庫呼叫的 await（${sourceTextOf(call)}）：` +
        '即使外層包 Promise.all，也仍然是 N 次資料庫往返、N 個連線池 slot——' +
        '資料量大時會把連線池吃光，讓其他請求逾時，是比循序 N+1 更難查的同一條規則（§4.5）',
    )
  }

  // --- 形狀 4：遞迴函式，每一層各查一次 ---
  const checkRecursiveFunction = (name: string, body: ts.ConciseBody | undefined): void => {
    if (body === undefined) return
    let selfCall: ts.CallExpression | null = null
    let dbAwait: { awaitExpr: ts.AwaitExpression; call: ts.CallExpression } | null = null
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
        selfCall = node
      }
      if (ts.isAwaitExpression(node)) {
        const call = unwrapAwaitedCall(node)
        if (call !== null && dbCall(call)) dbAwait = { awaitExpr: node, call }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    if (selfCall === null || dbAwait === null) return

    const { awaitExpr, call } = dbAwait
    const check = EXEMPTION_CHECK_NODES([body, awaitExpr], sourceFile)
    if (check.exempted) return
    if (check.missingReason) {
      record(awaitExpr, 'recursive', `遞迴函式 ${name} 每一層各查一次：豁免標記缺理由，視為違規`)
      return
    }
    record(
      awaitExpr,
      'recursive',
      `遞迴函式 ${name} 每一層各發一次資料庫呼叫（${sourceTextOf(call)}）：` +
        '沿父鏈／子鏈遞迴查詢是 N+1 的一種形狀，正確作法是先一次撈出整批候選列，' +
        '在記憶體中組出鏈狀或樹狀結構（§4.5，同 domain 層的 buildDepartmentTree 寫法）',
    )
  }

  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) {
      const call = unwrapAwaitedCall(node)
      if (call !== null && dbCall(call)) checkLoopBody(node, call)
    }

    if (ts.isCallExpression(node)) {
      const forEachCallback = asyncCallbackOf(node, ['forEach'])
      if (forEachCallback !== null) checkAsyncCallbackDbAwait(node, forEachCallback, 'foreach-async')

      const mapCallback = asyncCallbackOf(node, ['map', 'flatMap'])
      if (mapCallback !== null) checkAsyncCallbackDbAwait(node, mapCallback, 'map-async')
    }

    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      checkRecursiveFunction(node.name.text, node.body)
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = node.initializer
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body !== undefined) {
        checkRecursiveFunction(node.name.text, init.body)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  const exemptionMarkerCount = (code.match(new RegExp(EXEMPTION_PATTERN.source, 'g')) ?? []).length

  return { violations, exemptionMarkerCount }
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有 `.ts` 檔，排除 `__tests__` 目錄與 `*.test.ts`（理由見檔頭）。 */
const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return []

  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(path))
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

const files = listFiles(SCAN_ROOT)

const violations: Violation[] = []
let totalExemptionMarkers = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = scanSource(source, repoPath(file))
  violations.push(...result.violations)
  totalExemptionMarkers += result.exemptionMarkerCount
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 內建樣本涵蓋七種形狀：
 *
 * 1. `loopRepositoryImport`：`for...of` 迴圈內 `await findEmployeeById(...)`，
 *    `findEmployeeById` 從 `./employees.repository.ts` import（判準 A）→ 違規。
 * 2. `promiseAllMap`：`Promise.all(ids.map(async (id) => { await findOwnerById(id) }))`，
 *    `findOwnerById` 從非 repository 路徑 import，靠命名慣例判準（判準 C）→ 違規。
 * 3. `recursiveChain`：具名函式 `loadAncestors` 遞迴呼叫自己，內部 `await db.select(...)`
 *    （判準 B：接收者是 `db`）→ 違規。
 * 4. `forEachAsync`：`.forEach(async (id) => { await findOwnerById(id) })` → 違規
 *    （且完全沒有 `await` 包住這個 `.forEach(` 呼叫本身，符合它「不會被等待」的既有 bug）。
 * 5. `missingReasonExemption`：與 1 同形狀，但豁免標記是 `// n-plus-one-ok`（沒有理由）→ 仍算違規。
 * 6. `fixedCountLoop`：`for...of` 迴圈呼叫 `runDatasetSync(code)`——不是 import 進來的名字、
 *    也不符合動詞前綴，本身不是資料庫呼叫 → 合法（對應「固定 9 個資料集」的真實案例）。
 * 7. `batchThenLoop`：先在迴圈外 `await findAllByIds(ids)` 一次查完，迴圈內只做純記憶體組裝
 *    → 合法。
 * 8. `exemptedLoop`：與 1 同形狀，但豁免標記是 `// n-plus-one-ok: 固定 9 個資料集，理由見排程器檔頭`
 *    → 合法（且計入豁免標記次數）。
 *
 * 預期：5 則違規（1、2、3、4、5），豁免標記出現 2 次（5、8）。
 */
const SELF_TEST_SAMPLE = [
  "import { findEmployeeById } from './employees.repository.ts'",
  "import { findOwnerById } from '../shared/owner-lookup.ts'",
  "import { findAllByIds } from './owners.repository.ts'",
  '',
  'async function loopRepositoryImport(ids) {',
  '  for (const id of ids) {',
  '    await findEmployeeById(id)',
  '  }',
  '}',
  '',
  'async function promiseAllMap(ids) {',
  '  await Promise.all(ids.map(async (id) => {',
  '    await findOwnerById(id)',
  '  }))',
  '}',
  '',
  'const loadAncestors = async (id) => {',
  '  const row = await db.select().from(departments).where(eq(departments.id, id))',
  '  if (row.parentId !== null) await loadAncestors(row.parentId)',
  '}',
  '',
  'async function forEachAsync(ids) {',
  '  ids.forEach(async (id) => {',
  '    await findOwnerById(id)',
  '  })',
  '}',
  '',
  'async function missingReasonExemption(ids) {',
  '  for (const id of ids) {',
  '    // n-plus-one-ok',
  '    await findEmployeeById(id)',
  '  }',
  '}',
  '',
  'async function fixedCountLoop(codes) {',
  '  for (const code of codes) {',
  '    await runDatasetSync(code)',
  '  }',
  '}',
  '',
  'async function batchThenLoop(ids) {',
  '  const rows = await findAllByIds(ids)',
  '  const result = []',
  '  for (const row of rows) {',
  '    result.push(transform(row))',
  '  }',
  '  return result',
  '}',
  '',
  'async function exemptedLoop(codes) {',
  '  for (const code of codes) {',
  '    // n-plus-one-ok: 固定 9 個資料集，理由見排程器檔頭',
  '    await findEmployeeById(code)',
  '  }',
  '}',
].join('\n')

const SELF_TEST_EXPECTED_VIOLATIONS = 5
const SELF_TEST_EXPECTED_EXEMPTION_MARKERS = 2

const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個檔案（${repoPath(SCAN_ROOT)}）：目錄可能搬家了，這次掃描等於沒跑`)
}

const selfTestResult = scanSource(SELF_TEST_SAMPLE, '<self-test>')
if (selfTestResult.violations.length !== SELF_TEST_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `內建樣本應命中 ${String(SELF_TEST_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestResult.violations.length)} 則：` +
      `${JSON.stringify(selfTestResult.violations.map((v) => `${v.kind}@${String(v.line)}`))}——判斷邏輯已經失效`,
  )
}
if (selfTestResult.exemptionMarkerCount !== SELF_TEST_EXPECTED_EXEMPTION_MARKERS) {
  selfCheckFailures.push(
    `內建樣本應找到 ${String(SELF_TEST_EXPECTED_EXEMPTION_MARKERS)} 處 n-plus-one-ok 標記，` +
      `實際 ${String(selfTestResult.exemptionMarkerCount)} 處：豁免標記的計數邏輯已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort(['N+1 掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：', ...selfCheckFailures.map((line) => `  ✗ ${line}`)])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `發現 ${String(violations.length)} 處疑似 N+1 查詢（禁止在迴圈中逐筆查詢資料庫，§4.5）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：把迴圈裡逐筆查詢的鍵值先蒐集成陣列，改成單一 `WHERE ... IN (...)` 查詢一次撈完，',
      '再用 Map 在記憶體中對應回去。若這裡的迴圈確實與資料量無關（例如固定次數的獨立工作），',
      '在觸發違規的那一行或正上方一行加上 `// n-plus-one-ok: <理由>`（理由不可留空），',
      '判準與已知的偽陽性／偽陰性完整寫在 apps/api/scripts/check-n-plus-one.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `N+1 查詢檢查通過：${String(files.length)} 個檔案，0 處違規，` +
    `${String(totalExemptionMarkers)} 處 n-plus-one-ok 豁免標記。\n`,
)
