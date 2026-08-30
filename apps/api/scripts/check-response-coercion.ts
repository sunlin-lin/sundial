/**
 * 回應方向強制轉型欄位掃描：`modules/**​/*.routes.ts` 裡，**被 `response:` 引用到的 schema**，
 * 不得使用 Elysia 重新定義過的 `t.Integer`／`t.Number`／`t.Boolean`（可強制轉型版本），一律要改用
 * TypeBox 原生的 `Type.Integer`／`Type.Number`／`Type.Boolean`。
 *
 * ## 為什麼要擋：這件事已經真的發生過，而且發生過三次
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
 * **第二次是這支腳本自己漏掉的**：`shared/field-schemas.ts` 的 `Minutes`（`workedMinutes`／
 * `lateMinutes`／`earlyLeaveMinutes`／`absenceMinutes`，`attendance-results.routes.ts` 的
 * `response:` 使用）曾經同樣是 Elysia 的 `t.Integer`，卻沒有被抓到——原因是本檔原本的識別字追蹤
 * 只認得到「本檔頂層 `const`」，`Minutes` 是 `import` 進來的識別字，在 `attendance-results.routes.ts`
 * 裡沒有初始化運算式可以展開，因此連誤報都不會，直接被略過。這條後來已經修好（見下方「識別字追蹤」與
 * `collectNamedImportNames`），但值得記下：**跨檔案 import 的 schema 常數，尤其是
 * `shared/field-schemas.ts` 這種全站共用的定義檔，一個沒改乾淨的 export 會同時污染每一個 import
 * 它的模組，而且用「本檔常數」為範圍的追蹤天生就看不到它**——這正是這支腳本檔頭原本誠實列出的
 * 盲區，不是憑空猜的風險。
 *
 * **第三次是 `shared/envelope.ts` 的 `expiresIn`**：`BaseResponse`（envelope 的出口層形狀）曾經把
 * `expiresIn` 宣告成 Elysia 的 `t.Integer`，而 `envelope()` 是**全部端點共用的回應外殼**——每一支
 * 端點的 `response:` 都呼叫 `envelope(dataSchema)`，卻沒有一支端點在自己的 `response:` 字面值裡
 * 直接寫出 `expiresIn`，這個欄位是 `envelope()` 這個函式**自己組出來**、混進每一包回應的。前兩次
 * 修的都是「`response:` 引用到的 schema 常數」，識別字追蹤沿著 `response:` 底下的運算式往外展開就
 * 找得到；這一次不同——`envelope(X)` 呼叫本身會被追蹤到（因為它出現在 `response:` 底下），但
 * 舊版的追蹤只會展開**引數 `X`**，不會走進 `envelope` 這個函式**自己的實作**去看它組出來的
 * `BaseResponse` 長什麼樣。也就是說，`envelope.ts` 內部的 `expiresIn` 對這支腳本而言完全不在
 * 任何一次識別字展開的路徑上——不是「查不到就放棄」，是**根本沒有被列入要查的範圍**，比前兩次的
 * 盲區更深一層。修法見下方「envelope.ts 的追蹤：不只是引數，還有函式自己組出來的殼」。
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
 *      不收 `.name`，避免把 `Integer`／`username` 這類屬性名誤認成變數）。對每個識別字，依當前
 *      **作用域**（見下方「識別字追蹤：作用域會隨展開切換」）依序試著展開它的初始化運算式，對展開後
 *      的子樹重複同樣兩件事——直到沒有新的常數可以展開為止。
 *
 * ### 識別字追蹤：作用域會隨展開切換
 *
 * 每支 `*.routes.ts` 一開始查的是**自己檔案**的頂層 `const`（`AttendanceRecordDetailSchema` 引用
 * `AccuracyMeters`、`AccuracyMeters` 是 `t.Integer(...)`，就是靠這一層展開才追得到）。查不到的話，
 * 依序試兩個「全站共用、值得跨檔案追」的來源：
 *
 * 1. **`shared/field-schemas.ts`**（`collectNamedImportNames`，比對 import 宣告的 module
 *    specifier 是不是以 `/shared/field-schemas.ts` 結尾——本專案一律用相對路徑＋`.ts` 副檔名
 *    import，沒有路徑別名，見任一 `*.routes.ts` 的 import），是的話就到**預先讀取、解析過一次**的
 *    `field-schemas.ts` 頂層 `const` 表裡查它匯出時的初始化運算式（`attendance-results.
 *    routes.ts` 的 `Minutes` 就是靠這一層才追得到）。
 * 2. **`shared/envelope.ts`**（同樣用 `collectNamedImportNames`，比對尾端 `/shared/envelope.ts`），
 *    是的話到 envelope.ts 頂層 `const` 表裡查。**這一步查到的通常是 `envelope` 這個函式本身**
 *    （它的初始化運算式是一個箭頭函式），而不是一段 schema 物件字面值——展開箭頭函式一樣安全：
 *    識別字追蹤不分「這段運算式是不是 schema」，它只是機械地收集子樹裡的識別字並依序展開，箭頭函式
 *    的參數（例如 `dataSchema`）本身也會被收進識別字集合，但查不到宣告就安靜跳過，不影響其餘展開。
 *    展開 `envelope` 之後會遇到函式本體裡的 `BaseResponse` 識別字，這個識別字**不是** routes.ts
 *    的頂層常數、也不是從 field-schemas.ts 匯入的——它是 **envelope.ts 自己的頂層常數**。
 *
 * 這正是「作用域會切換」的地方：一旦識別字展開跨進了 field-schemas.ts 或 envelope.ts 的某個 export，
 * 繼續展開它內部出現的識別字時，查詢範圍必須換成**那個檔案自己的頂層 `const` 表**（以及它自己的
 * 跨檔案 import——envelope.ts 本身就從 field-schemas.ts 匯入 `TransportTS`），不能繼續套用發起
 * 這次掃描那支 `*.routes.ts` 的頂層常數表，否則 `BaseResponse`／`ErrorItem`／`WebFlowCodeSchema`
 * 這些只存在於 envelope.ts 自己檔案裡的名字永遠查不到。程式碼裡這是 `ConstResolver` 型別——每次
 * 展開回傳「這段運算式」與「繼續展開它時該用哪一個 resolver」的配對，而不是單一個扁平函式（見
 * `buildImportAwareResolver`）。
 *
 * **request 方向不受限制**：`body:` 底下用 `t.Integer` 是對的，那正是它存在的理由（見上方
 * field-schemas.ts 的引用）。這支腳本只從 `response:` 出發做識別字追蹤，`body:` 物件字面值本身
 * 從來不是任何一次追蹤的起點——一個常數如果只在 `body:` 出現、從未被 `response:` 直接或間接引用，
 * 永遠不會被納入掃描範圍，這是刻意的，不是遺漏。
 *
 * ## 抓不到什麼
 *
 * - **跨檔案引用、但不是從 `shared/field-schemas.ts` 或 `shared/envelope.ts` 匯入的 schema**：
 *   識別字追蹤在「本檔頂層 `const`」「從 field-schemas.ts 匯入」「從 envelope.ts 匯入」三個來源都
 *   查不到時就會放棄——例如 `field-schemas.ts` 自己 export 的 `Nullable`／`Uuid`（這兩個不是可強制
 *   轉型型別，查不到也不會誤判成違規，只是這支腳本沒有實際去看它們乾不乾淨），或任何從 `shared/`
 *   底下其他檔案、或從別的業務模組匯入的常數，都不在追蹤範圍內。**只涵蓋這兩份全站共用檔是刻意
 *   縮小的範圍**，不是完整的跨模組解析——理由見下方「把 Elysia 的 `t` 匯入成別的名字」同一種取捨：
 *   抓兩個全站共用、最容易一次污染多個模組的檔案，比起蓋一套通用的模組解析器，成本低很多，也還沒有
 *   第三個案例證明需要更廣。
 * - **`shared/field-schemas.ts`／`shared/envelope.ts` 的 import 寫法必須是相對路徑，且以
 *   `/shared/field-schemas.ts`／`/shared/envelope.ts` 結尾**：判準是比對 module specifier 文字的
 *   尾端，不是真的解析檔案系統路徑（與本檔其餘識別字追蹤「讀原始碼字面」同一種立場）。改用 tsconfig
 *   路徑別名（例如 `@shared/envelope`）、或把檔案搬到別的相對深度但保留完全不同的檔名，這支腳本會
 *   認不出來，是與「把 `t` 匯入成別的名字」相同性質的限制。
 * - **envelope.ts 內部除了 `envelope()` 這個函式以外，還有別的方式組出回應**：這支腳本能追到
 *   `envelope()` 是因為每一支端點的 `response:` 都直接呼叫它。如果將來 envelope.ts 又長出第二個
 *   對外函式（例如某種特化版本），只要它也是 envelope.ts 自己的頂層 `const`／`export`，識別字追蹤
 *   一樣追得到（追蹤不特別認 `envelope` 這個名字，只是機械地展開任何從 envelope.ts 匯入的識別字）；
 *   但如果回應是繞過 `envelope()`、直接在 `response:` 手刻物件字面值組出來的，那條路徑本來就違反
 *   §1.8.1「禁止手刻 envelope」，不是這支腳本的責任範圍。
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
 * 零命中，而「回應方向不得可強制轉型」這條規則就在沒有人察覺的情況下失效了）。`shared/
 * field-schemas.ts`、`shared/envelope.ts` 找不到都必須失敗，理由相同：跨檔案追蹤那一步會安靜地
 * 退化成「查不到就跳過」，而不會有任何錯誤提示這一半的規則已經失效。
 *
 * 另外用兩份內建樣本驗證判斷邏輯本身：
 *
 * - 主樣本涵蓋五支「端點」，三種違規、兩種合法形狀（`response` 直接使用 `t.Integer`；`response`
 *   引用的本檔常數用了 `t.Number`；`response` 引用的常數是從 `shared/field-schemas.ts` 具名匯入，
 *   匯出時是 `t.Integer`）與兩種合法形狀（`response` 用 `Type.Integer`；`body` 用 `t.Integer`，且
 *   該常數從未被 `response` 引用）。
 * - 另一份專門驗證 envelope.ts 的追蹤（見 `SELF_TEST_ENVELOPE_SAMPLE`）：兩支「端點」各自呼叫從
 *   假 `shared/envelope.ts` 具名匯入的函式，一乾淨一違規，違規那支重現 `expiresIn` 曾經誤用
 *   `t.Integer` 的形狀——證明這支腳本真的會爬進 `envelope()` 函式**自己的實作**去找它組出來的
 *   `BaseResponse`，而不是只看呼叫時傳入的 `dataSchema` 引數。
 *
 * 兩份樣本都**不依賴 repo 現況**（都自帶假的 field-schemas.ts／envelope.ts 樣本），即使有一天全
 * 專案的欄位都寫對了，這兩項仍然證明得了腳本擋得住東西。
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

/** 全站共用、值得跨檔案追蹤的第一份來源：一個沒改乾淨的 export，會同時污染每一個 import 它的模組
 * （見檔頭「為什麼要擋」的 `Minutes` 那段）。 */
const FIELD_SCHEMAS_FILE = join(API_ROOT, 'src/shared/field-schemas.ts')

/** 判斷一個 import 宣告是不是在匯入 {@link FIELD_SCHEMAS_FILE}：比對 module specifier 文字的
 * 尾端，不解析檔案系統路徑（見檔頭「抓不到什麼」對這個取捨的說明）。 */
const FIELD_SCHEMAS_IMPORT_SUFFIX = '/shared/field-schemas.ts'

/** 全站共用、值得跨檔案追蹤的第二份來源：**全部端點共用的回應外殼**，`expiresIn` 曾經誤用
 * `t.Integer` 卻不在任何一次識別字展開路徑上，就是靠追這份檔案才補得到（見檔頭「為什麼要擋」第三段）。 */
const ENVELOPE_FILE = join(API_ROOT, 'src/shared/envelope.ts')

/** 判斷一個 import 宣告是不是在匯入 {@link ENVELOPE_FILE}，判準與 {@link FIELD_SCHEMAS_IMPORT_SUFFIX}
 * 一致：比對尾端文字，不解析檔案系統路徑。 */
const ENVELOPE_IMPORT_SUFFIX = '/shared/envelope.ts'

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
 * 「可能是本檔某個常數」去查表，雖然查不到時只是安靜地沒有命中，但這樣做的雜訊沒有意義。
 *
 * 這支函式對節點形狀不做任何假設——不論子樹是一段 schema 物件字面值，還是（展開 `envelope` 之後）
 * 一整個箭頭函式，都用同一套機械式收集，查不到宣告的識別字（例如箭頭函式的參數名）安靜跳過即可。 */
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
 * `*.routes.ts`／`field-schemas.ts`／`envelope.ts` 一貫把常數（含 `envelope` 這個函式本身，
 * 它也是用 `export const envelope = (...) => ...` 宣告）宣告在檔案頂層的寫法。 */
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

/** 從一支檔案的 import 宣告裡，找出「從某個 module specifier 尾端符合 `suffix` 的檔案具名匯入」的
 * 本檔識別字 → 匯出名稱（絕大多數情況兩者文字相同，只有 `import { X as Y }` 這種改名寫法才不同）。
 * `shared/field-schemas.ts`／`shared/envelope.ts` 都是同一套判準，差別只在傳入的 `suffix`
 * 不同——判準與各自的 `*_IMPORT_SUFFIX` 常數一致，見檔頭：只比對相對路徑文字尾端，不解析檔案系統
 * 路徑。 */
const collectNamedImportNames = (sourceFile: ts.SourceFile, suffix: string): ReadonlyMap<string, string> => {
  const names = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!statement.moduleSpecifier.text.endsWith(suffix)) continue
    const namedBindings = statement.importClause?.namedBindings
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) continue
    for (const element of namedBindings.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text)
    }
  }
  return names
}

/** 一次識別字解析的結果：展開後的運算式，以及「如果這段運算式裡還有沒解開的識別字，該用哪個
 * resolver 繼續查」。跨檔案展開之後（例如 `*.routes.ts` 的識別字展開到 `shared/envelope.ts` 的一個
 * 頂層常數），繼續查找必須切換成該檔案自己的作用域——否則 `BaseResponse` 這種只存在於 envelope.ts
 * 自己頂層的識別字永遠查不到（見檔頭「識別字追蹤：作用域會隨展開切換」）。 */
type ConstResolver = (
  name: string,
) => { readonly expression: ts.Expression; readonly resolver: ConstResolver } | undefined

/**
 * 建一個「本檔頂層常數優先，查不到就依序試跨檔案來源」的 resolver。
 *
 * 三種呼叫端都是同一套邏輯：
 * - `*.routes.ts`：`localConsts` 是自己的頂層常數，`importSources` 是
 *   `[field-schemas.ts 的 resolver, envelope.ts 的 resolver]`。
 * - `envelope.ts` 自己：`localConsts` 是它自己的頂層常數（`BaseResponse`／`ErrorItem`／
 *   `envelope` 本身……），`importSources` 是 `[field-schemas.ts 的 resolver]`
 *   （envelope.ts 會從 field-schemas.ts 匯入 `TransportTS`）。
 * - `field-schemas.ts` 自己：`localConsts` 是它自己的頂層常數，`importSources` 是空陣列
 *   （它不再往其他共用檔跨一層）。
 *
 * 展開後回傳的 `resolver` 一律是**同一個 resolver 自己**：同一份檔案的頂層常數本來就可能互相引用
 * （例如 envelope.ts 的 `BaseResponse` 引用 `ErrorItem`），繼續用同一個 resolver 才查得到。
 */
const buildImportAwareResolver = (
  localConsts: ReadonlyMap<string, ts.Expression>,
  importSources: readonly { readonly importNames: ReadonlyMap<string, string>; readonly resolver: ConstResolver }[],
): ConstResolver => {
  const resolver: ConstResolver = (name) => {
    const local = localConsts.get(name)
    if (local !== undefined) return { expression: local, resolver }
    for (const { importNames, resolver: targetResolver } of importSources) {
      const exportedName = importNames.get(name)
      if (exportedName === undefined) continue
      const resolved = targetResolver(exportedName)
      if (resolved !== undefined) return resolved
    }
    return undefined
  }
  return resolver
}

/**
 * 對一段「schema 運算式」做識別字追蹤（closure），把沿路發現的違規收進 `violations`。
 *
 * @param chain 走到這裡沿路展開過的常數名稱（由外往內，不分本檔或跨檔案匯入），只用來組違規訊息，
 *   不影響判斷本身。空陣列代表這段運算式就是 `response:` 底下的字面值本身，不是展開某個常數
 *   展開出來的。
 * @param resolveConst 見 {@link ConstResolver}：給一個識別字文字，回傳它的初始化運算式與「繼續展開
 *   它時該用哪個 resolver」（查不到就是 `undefined`，代表抓不到——見檔頭「抓不到什麼」）。
 * @param visited 已經展開過的常數名稱，避免同一個常數在同一次呼叫鏈裡被重複展開（理論上 schema
 *   常數不會互相循環引用，這裡只是防禦）。
 *
 * 違規的位置一律取自 `call.getSourceFile()`，不是呼叫端傳進來的那份 `sourceFile`——展開到
 * `shared/field-schemas.ts`／`shared/envelope.ts` 的常數之後，`call` 這個節點實際上屬於那份檔案的
 * 語法樹，位置理所當然要指向那裡，而不是最初發起掃描的那支 `*.routes.ts`（`ts.Node.getSourceFile()`
 * 回傳的是節點實際所屬的語法樹根節點，不受「是哪一次呼叫觸發展開」影響，見 `recordViolation`）。
 */
const evaluateSchemaExpression = (
  node: ts.Node,
  chain: readonly string[],
  resolveConst: ConstResolver,
  visited: Set<string>,
  onViolation: (call: ts.CallExpression, chain: readonly string[]) => void,
): void => {
  for (const call of collectCoercibleCalls(node)) onViolation(call, chain)

  for (const name of collectIdentifierNames(node)) {
    if (visited.has(name)) continue
    const resolved = resolveConst(name)
    if (resolved === undefined) continue // 抓不到：跨檔案引用（field-schemas.ts／envelope.ts 除外）或不是 const 宣告，見檔頭。
    visited.add(name)
    evaluateSchemaExpression(resolved.expression, [...chain, name], resolved.resolver, visited, onViolation)
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

/**
 * 掃單一檔案（或內建樣本字串）。
 *
 * @param fieldSchemasResolver 供 `field-schemas.ts` 匯入解析用的 resolver，由呼叫端預先建好
 *   （見 {@link buildImportAwareResolver}）——每支 `*.routes.ts` 各自重新解析 field-schemas.ts
 *   一次沒有必要，這份 resolver 對整次掃描而言是常數。
 * @param envelopeResolver 同上，供 `envelope.ts` 匯入解析用。
 * @param reportedPositions 違規去重集合，**呼叫端可以跨多次 `scanSource` 呼叫共用同一個
 *   `Set`**：同一個 `shared/field-schemas.ts`／`shared/envelope.ts` 常數可能被多支 `*.routes.ts`
 *   分別 import 引用，共用集合能避免同一處違規因為被多個模組引用而重複列出（本檔內常數重複
 *   引用——例如 `CommonFailureResponses`——則不需要跨呼叫共用，但共用一個空集合不影響正確性）。
 *   不傳的話每次呼叫各自建一個新的，內建樣本測試就是這樣用。
 */
const scanSource = (
  code: string,
  file: string,
  fieldSchemasResolver: ConstResolver,
  envelopeResolver: ConstResolver,
  reportedPositions: Set<string> = new Set(),
): FileScanResult => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const localConsts = collectTopLevelConstDeclarations(sourceFile)
  const fieldSchemasImportNames = collectNamedImportNames(sourceFile, FIELD_SCHEMAS_IMPORT_SUFFIX)
  const envelopeImportNames = collectNamedImportNames(sourceFile, ENVELOPE_IMPORT_SUFFIX)
  const resolveConst = buildImportAwareResolver(localConsts, [
    { importNames: fieldSchemasImportNames, resolver: fieldSchemasResolver },
    { importNames: envelopeImportNames, resolver: envelopeResolver },
  ])
  const violations: Violation[] = []
  let responseDeclarationCount = 0

  const recordViolation = (call: ts.CallExpression, chain: readonly string[]): void => {
    // 用 `call` 自己的 `getSourceFile()`，不是本函式的 `sourceFile`：展開到 field-schemas.ts／
    // envelope.ts 常數之後，`call` 屬於那份檔案的語法樹，位置與檔名都要指向那裡（見
    // `evaluateSchemaExpression` 檔頭）。本檔內的違規則兩者是同一個物件，行為不變。
    const callSourceFile = call.getSourceFile()
    const { line, character } = callSourceFile.getLineAndCharacterOfPosition(call.getStart(callSourceFile))
    // 去重鍵含檔名：`reportedPositions` 可能跨多支 `*.routes.ts` 的掃描共用（見上方參數說明），
    // 只用行號欄號去重會讓不同檔案裡湊巧同一行同一欄的違規互相蓋掉。
    const position = `${callSourceFile.fileName}:${String(line + 1)}:${String(character + 1)}`
    if (reportedPositions.has(position)) return
    reportedPositions.add(position)

    const methodName = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : '?'
    const nativeReplacement = `Type.${methodName}`
    const viaText = chain.length === 0 ? 'response 直接使用' : `response 經由 ${chain.join(' → ')} 引用到的常數使用`

    violations.push({
      file: callSourceFile.fileName,
      line: line + 1,
      column: character + 1,
      source: call.getText(callSourceFile).split('\n')[0]?.trim() ?? '',
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
          evaluateSchemaExpression(expression, [], resolveConst, new Set(), recordViolation)
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

/** 解析一份共用檔（`field-schemas.ts`／`envelope.ts`）成它自己的 `ts.SourceFile`，檔案不存在時
 * 回傳 `undefined`——不是靜靜放行，下面的自我檢查會因此失敗。 */
const parseSharedFile = (path: string): ts.SourceFile | undefined =>
  existsSync(path)
    ? ts.createSourceFile(repoPath(path), readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    : undefined

/** `shared/field-schemas.ts` 只需要讀取、解析一次，供本次掃描全部 `*.routes.ts` 共用。它不再往
 * 其他共用檔跨一層，`importSources` 是空陣列。 */
const fieldSchemasSourceFile = parseSharedFile(FIELD_SCHEMAS_FILE)
const fieldSchemasResolver = buildImportAwareResolver(
  fieldSchemasSourceFile === undefined ? new Map() : collectTopLevelConstDeclarations(fieldSchemasSourceFile),
  [],
)

/** `shared/envelope.ts` 同樣只解析一次。它自己會從 `field-schemas.ts` 匯入 `TransportTS`，所以
 * `importSources` 帶入 {@link fieldSchemasResolver}——這正是「作用域會隨展開切換」在真實檔案上的
 * 呈現：展開到 envelope.ts 的 `BaseResponse` 之後，如果 `BaseResponse` 裡還有識別字要繼續展開，
 * 要用 envelope.ts 自己的頂層常數表，查不到才再跨去 field-schemas.ts。 */
const envelopeSourceFile = parseSharedFile(ENVELOPE_FILE)
const envelopeFieldSchemasImportNames =
  envelopeSourceFile === undefined
    ? new Map()
    : collectNamedImportNames(envelopeSourceFile, FIELD_SCHEMAS_IMPORT_SUFFIX)
const envelopeResolver = buildImportAwareResolver(
  envelopeSourceFile === undefined ? new Map() : collectTopLevelConstDeclarations(envelopeSourceFile),
  [{ importNames: envelopeFieldSchemasImportNames, resolver: fieldSchemasResolver }],
)

const violations: Violation[] = []
let totalResponseDeclarationCount = 0
// 跨檔案共用：同一個 field-schemas.ts／envelope.ts 常數若被多支 *.routes.ts 引用，違規只列一次
// （見 `scanSource` 的 `reportedPositions` 參數說明）。
const reportedPositions = new Set<string>()

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = scanSource(source, repoPath(file), fieldSchemasResolver, envelopeResolver, reportedPositions)
  violations.push(...result.violations)
  totalResponseDeclarationCount += result.responseDeclarationCount
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 內建樣本涵蓋五支「端點」，三種違規、兩種合法形狀：
 *
 * 1. `valid-native`：`response` 用 `Type.Integer(...)`（TypeBox 原生）→ 合法。
 * 2. `valid-request-only`：`body` 用 `t.Integer(...)`，但這個常數從未被任何 `response` 引用
 *    （`response` 只回 `t.Null()`）→ 合法，證明 `body:` 底下的 `t.Integer` 真的不受這支腳本管。
 * 3. `invalid-direct`：`response` 直接寫 `t.Integer(...)` → 違規（不經任何常數，`chain` 為空）。
 * 4. `invalid-via-const`：`response` 引用本檔常數 `InvalidLocalConst`，該常數是 `t.Number(...)`
 *    → 違規（`chain` 長度 1，證明識別字追蹤真的有展開常數，不是只看字面值本身）。
 * 5. `invalid-via-field-schemas-import`：`response` 引用從 `shared/field-schemas.ts` 具名匯入的
 *    `ExternalCoercibleConst`，本檔完全查不到它的宣告（不是本檔頂層 `const`）→ 違規，且違規位置
 *    必須落在 {@link SELF_TEST_FIELD_SCHEMAS_FILE} 而不是本樣本自己——這一項專門證明跨檔案追蹤
 *    真的有走到 `shared/field-schemas.ts`，不是只認得到本檔常數（見檔頭「為什麼要擋」的 `Minutes`
 *    那段：這正是這支腳本曾經漏掉的情況）。
 *
 * 這份樣本刻意不涉及 `shared/envelope.ts`（不 import `envelope`，樣本裡的 `envelope(...)` 呼叫
 * 因此查不到宣告、被安靜略過）——envelope.ts 的追蹤由下面 {@link SELF_TEST_ENVELOPE_SAMPLE} 單獨
 * 驗證，兩份樣本互不干擾，才能各自準確核對「幾個宣告、幾則違規」。
 *
 * 預期：5 個 `response:` 宣告，3 則違規。
 */
const SELF_TEST_SAMPLE = [
  "import { Elysia, t } from 'elysia'",
  "import { Type } from '@sinclair/typebox'",
  "import { ExternalCoercibleConst } from '../../../shared/field-schemas.ts'",
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
  "  .post('/self-test/invalid-via-field-schemas-import', handler, {",
  '    body: t.Object({}),',
  '    response: { 200: envelope(t.Object({ minutes: ExternalCoercibleConst })) },',
  '  })',
].join('\n')

/** 自我檢查跨檔案追蹤那一步用的假 `shared/field-schemas.ts`：**不讀真正的 field-schemas.ts**，
 * 理由是這一項要驗證的是「查不到本檔常數時，會不會去查 field-schemas.ts 的匯出」這個機制本身，
 * 而不是「field-schemas.ts 現在的內容乾不乾淨」——後者會隨 repo 演進而變，用真檔案會讓這項自我
 * 檢查在某一天全站欄位都寫對之後失去意義（同一份顧慮見上方 §7.2 說明）。 */
const SELF_TEST_FIELD_SCHEMAS_FILE = '<self-test>/shared/field-schemas.ts'
const SELF_TEST_FIELD_SCHEMAS_SOURCE = [
  "import { t } from 'elysia'",
  'export const ExternalCoercibleConst = t.Integer({ minimum: 0 })',
].join('\n')
const selfTestFieldSchemaSourceFile = ts.createSourceFile(
  SELF_TEST_FIELD_SCHEMAS_FILE,
  SELF_TEST_FIELD_SCHEMAS_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
const selfTestFieldSchemasResolver = buildImportAwareResolver(
  collectTopLevelConstDeclarations(selfTestFieldSchemaSourceFile),
  [],
)

/** 主樣本不涉及 envelope.ts（見上方 `SELF_TEST_SAMPLE` 檔頭），所以掃它時 envelope 的 resolver
 * 給一個永遠查不到的空 resolver 即可——這也順便證明「查不到 envelope 匯入」時腳本不會誤報。 */
const EMPTY_RESOLVER: ConstResolver = () => undefined

const SELF_TEST_EXPECTED_RESPONSE_DECLARATIONS = 5
const SELF_TEST_EXPECTED_VIOLATIONS = 3

/**
 * 專門驗證 `shared/envelope.ts` 追蹤的內建樣本：兩支「端點」各自呼叫從假 `shared/envelope.ts`
 * 具名匯入的函式。
 *
 * 1. `envelope-valid`：假 envelope.ts 的 `envelopeOk` 組出來的殼用 `Type.Integer` → 合法。
 * 2. `envelope-invalid`：假 envelope.ts 的 `envelopeBad` 組出來的殼用 `t.Integer`（重現真正的
 *    `envelope.ts` 裡 `expiresIn` 曾經誤用的形狀）→ 違規，且違規位置必須落在
 *    {@link SELF_TEST_ENVELOPE_FILE}，不是本樣本自己——這一項專門證明這支腳本真的會爬進
 *    `envelope(...)` 呼叫展開到的函式本體，找到它內部再引用的 `BaseResponseBad`，而不是只看
 *    呼叫時傳入的 `dataSchema` 引數（本樣本兩支端點傳入的引數都是乾淨的 `t.Object({})`）。
 *
 * 假 envelope.ts 不讀真正的 `envelope.ts`，理由與 {@link SELF_TEST_FIELD_SCHEMAS_SOURCE} 相同：
 * 這一項要驗證的是機制本身，不是 `envelope.ts` 現在的內容乾不乾淨。
 *
 * 預期：2 個 `response:` 宣告，1 則違規。
 */
const SELF_TEST_ENVELOPE_FILE = '<self-test>/shared/envelope.ts'
const SELF_TEST_ENVELOPE_SOURCE = [
  "import { t } from 'elysia'",
  "import { Type } from '@sinclair/typebox'",
  'export const BaseResponseOk = t.Object({ expiresIn: Type.Integer() })',
  'export const envelopeOk = (dataSchema) => t.Intersect([BaseResponseOk, t.Object({ data: dataSchema })])',
  'export const BaseResponseBad = t.Object({ expiresIn: t.Integer() })',
  'export const envelopeBad = (dataSchema) => t.Intersect([BaseResponseBad, t.Object({ data: dataSchema })])',
].join('\n')
const selfTestEnvelopeSourceFile = ts.createSourceFile(
  SELF_TEST_ENVELOPE_FILE,
  SELF_TEST_ENVELOPE_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
const selfTestEnvelopeResolver = buildImportAwareResolver(
  collectTopLevelConstDeclarations(selfTestEnvelopeSourceFile),
  [],
)

const SELF_TEST_ENVELOPE_SAMPLE = [
  "import { Elysia, t } from 'elysia'",
  "import { envelopeOk, envelopeBad } from '../../../shared/envelope.ts'",
  '',
  'const app = new Elysia()',
  "  .post('/self-test/envelope-valid', handler, {",
  '    body: t.Object({}),',
  '    response: { 200: envelopeOk(t.Object({})) },',
  '  })',
  "  .post('/self-test/envelope-invalid', handler, {",
  '    body: t.Object({}),',
  '    response: { 200: envelopeBad(t.Object({})) },',
  '  })',
].join('\n')

const SELF_TEST_ENVELOPE_EXPECTED_RESPONSE_DECLARATIONS = 2
const SELF_TEST_ENVELOPE_EXPECTED_VIOLATIONS = 1

const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個 *.routes.ts 檔案（${repoPath(SCAN_ROOT)}）：目錄可能搬家了，這次掃描等於沒跑`)
}

if (fieldSchemasSourceFile === undefined) {
  selfCheckFailures.push(
    `找不到 ${repoPath(FIELD_SCHEMAS_FILE)}：跨檔案追蹤的一半（見檔頭「為什麼要擋」的 Minutes` +
      '一段）已經退化成查不到，任何從這份檔案匯入的可強制轉型常數都不會被抓到',
  )
}

if (envelopeSourceFile === undefined) {
  selfCheckFailures.push(
    `找不到 ${repoPath(ENVELOPE_FILE)}：跨檔案追蹤的另一半（見檔頭「為什麼要擋」的 expiresIn` +
      '一段）已經退化成查不到，envelope() 組出來的回應外殼不會再被檢查',
  )
}

// 命中 0 個 response: 宣告必須失敗（§7.2 的核心要求，見檔頭）：modules/ 搬家、*.routes.ts 改名、
// .post( 呼叫形狀改變，都會讓這支腳本照跑、照綠、零命中，規則就在沒有人察覺的情況下失效了。
if (totalResponseDeclarationCount === 0) {
  selfCheckFailures.push(
    `${repoPath(SCAN_ROOT)} 底下的 *.routes.ts 找不到任何 response: 宣告：` +
      '規則的檢查對象消失了，這次掃描等於沒跑（也可能是找路由設定物件的邏輯已經失效）',
  )
}

const selfTestResult = scanSource(SELF_TEST_SAMPLE, '<self-test>', selfTestFieldSchemasResolver, EMPTY_RESOLVER)
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

const selfTestEnvelopeResult = scanSource(
  SELF_TEST_ENVELOPE_SAMPLE,
  '<self-test-envelope>',
  EMPTY_RESOLVER,
  selfTestEnvelopeResolver,
)
if (selfTestEnvelopeResult.responseDeclarationCount !== SELF_TEST_ENVELOPE_EXPECTED_RESPONSE_DECLARATIONS) {
  selfCheckFailures.push(
    `envelope.ts 內建樣本應找到 ${String(SELF_TEST_ENVELOPE_EXPECTED_RESPONSE_DECLARATIONS)} 個 response: 宣告，` +
      `實際 ${String(selfTestEnvelopeResult.responseDeclarationCount)} 個：response: 宣告的辨識邏輯已經失效`,
  )
}
if (selfTestEnvelopeResult.violations.length !== SELF_TEST_ENVELOPE_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `envelope.ts 內建樣本應命中 ${String(SELF_TEST_ENVELOPE_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestEnvelopeResult.violations.length)} 則：envelope() 函式本體的識別字追蹤已經失效`,
  )
} else if (selfTestEnvelopeResult.violations[0]?.file !== SELF_TEST_ENVELOPE_FILE) {
  selfCheckFailures.push(
    `envelope.ts 內建樣本的違規應該落在 ${SELF_TEST_ENVELOPE_FILE}，` +
      `實際落在 ${selfTestEnvelopeResult.violations[0]?.file ?? '(無)'}：` +
      '違規位置的歸屬（getSourceFile）已經失效，可能誤指回發起掃描的那支 routes.ts',
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
      '轉型，response 另外用 Type.X，比照 apps/api/src/shared/field-schemas.ts 的 Pagination 檔頭、',
      'apps/api/src/shared/envelope.ts 的 expiresIn 檔頭，或',
      'apps/api/src/modules/attendance/records/attendance-records.routes.ts 的 LatitudeResponse／',
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
