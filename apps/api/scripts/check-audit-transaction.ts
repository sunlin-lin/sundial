/**
 * 稽核交易掃描：每一處 `recordAudit(` 呼叫的第一個引數，必須是**真正參與同一筆業務寫入的
 * 那一個交易 handle**（稽核計畫的三個硬規則之一）。
 *
 * ## 職責已經轉移：這支腳本現在擋的是什麼，不再是什麼
 *
 * **這支腳本曾經是唯一的把關**：`recordAudit` 原本收 `QueryRunner`（`db/client.ts`），
 * 而 `QueryRunner` 刻意讓連線池與交易物件滿足同一個型別（為了讓 repository 在交易內外用同一套
 * 寫法），代價是 `recordAudit(context.db, ...)` 與 `recordAudit(tx, ...)` 在編譯器眼裡完全等價
 * ——「有沒有交易」這件事編譯器答不出來，只能靠這支腳本讀 AST、認詞法上的巢狀
 * `.transaction(async (X) => ...)` 來確認。
 *
 * **「有沒有交易」現在由型別系統回答**：`recordAudit` 的簽章已經改收 `TransactionRunner`
 * （`db/client.ts`）——那是 `QueryRunner` 交集上只有真正交易物件才有的成員（`rollback`），
 * 連線池塞不進去。`recordAudit(context.db, ...)` 現在是**編譯錯誤**，不必再靠這支腳本才能發現。
 * 這也是為什麼計畫 §4.1「service 動作收交易 handle 作為第一個參數」能夠成立而不必再把
 * `.transaction(...)` 硬寫在呼叫 `recordAudit` 的同一個檔案、同一個回呼裡——舊版規則的判準
 * （詞法巢狀）擋不住「交易開在呼叫端、這裡只收一個外部 `tx: TransactionRunner` 參數」這種完全
 * 合法的重構，因為那個檔案裡根本看不到 `.transaction(`。
 *
 * **型別系統擋不住的，換這支腳本頂上**：`recordAudit(txA, ...)` 而業務寫入用的是 `txB`
 * ——兩個都是合法的 `TransactionRunner`，編譯器完全沒有意見（型別系統只管「這是不是一個交易」，
 * 不管「這是不是*那一個*交易」），但那兩個寫入實際上不在同一個交易裡，稽核與業務又會走回
 * `sessions-main.revoke-on-reuse.service.ts` 檔頭寫的那四種沒有交易的結果，最糟的是
 * 「業務寫入失敗、稽核卻成功」。這支腳本現在只回答一個問題：**`recordAudit` 用的那個 handle，
 * 是不是這個呼叫點唯一「看得到、可以合理相信是同一筆交易」的那一個**——不是「有沒有交易」。
 *
 * 唯一的整合測試（`sessions-main.revoke-on-reuse.test.ts` 的「★ 故意讓稽核失敗」）驗的是
 * **手工重組的複本**，不是 `revokeChainsOnReuse` 本體——那支測試的檔頭已經誠實寫明這一點：
 * 兩件事（作廢、稽核）在合法輸入下永遠同時成立或同時不成立，沒辦法只從公開介面單獨造出
 * 「作廢成功、稽核失敗」的案例，因此測試改用政策違規當觸發點，繞過了公開簽章。
 * 後果是把 `revoke-on-reuse.service.ts` 裡的 `tx` 換成另一個變數，那支測試照樣是綠的——
 * 這支腳本補的正是這個洞：不透過執行，直接讀 AST 確認「稽核用的就是那個可信的交易 handle」。
 *
 * ## 判準：AST，不是正則，兩條路徑擇一通過
 *
 * 純文字掃描沒辦法回答「這個呼叫有沒有被某個 `.transaction(...)` 包住」——巢狀的深度、
 * 縮排、換行方式在每個呼叫點都不同，正則要嘛漏判要嘛誤判。因此走 TypeScript 的 AST：
 * 找到 callee 名為 `recordAudit` 的 `CallExpression`，取第一個引數（必須是識別字，
 * 不能是 `context.db` 這種屬性存取——那本身就已經是違規，不需要再往上找）。
 * 這個識別字要通過下面兩條路徑**其中一條**才算合法：
 *
 * 1. **詞法巢狀**（原本唯一的路徑，交易開在同一個檔案、同一個回呼時適用）：從呼叫節點沿
 *    `parent` 鏈往上走，尋找 callee 是 `PropertyAccessExpression` 且屬性名為 `transaction`
 *    的 `CallExpression`，比對它的回呼（第一個引數，箭頭或一般函式）的第一個參數名是否等於
 *    前面取到的識別字。
 * 2. **收外部 handle**（計畫 §4.1 之後新增的路徑，交易開在呼叫端時適用）：找出「直接包住這個
 *    呼叫」的最近一層函式（箭頭函式、一般函式或函式宣告），比對它的**第一個參數**是否
 *    ——參數名等於前面取到的識別字，**而且**該參數的型別標註文字含有 `TransactionRunner`。
 *    只看最近一層，不像路徑 1 會一路往上找到檔案頂端：計畫 §4.1 定案「交易 handle 一律是
 *    第一個參數」，因此可信的 handle 只可能來自呼叫點所在函式自己的簽章，不會是外層某個
 *    無關函式的參數。型別標註文字只用字串比對（`/\bTransactionRunner\b/`），不解析型別
 *    ——與路徑 1 一樣刻意不建 `ts.Program`，見下段。
 *
 * 兩條路徑都沒找到相符的 → 違規：可能是傳了裸連線池（`QueryRunner` 但非 `TransactionRunner`
 * 的那一種寫法現在編譯器已經擋住，這裡剩下的多半是「傳了一個型別上合法但語意上是另一個交易」
 * 的 handle，即「兩個不同 handle」那種形狀）。
 *
 * **只走語法樹，不做型別解析**（不建 `ts.Program`）：這條規則要問的是「程式碼長什麼樣子」，
 * 不是「這個識別字的型別是什麼」，語法層級的答案就是完整答案，也讓這支腳本不必依賴
 * `tsconfig.json` 能不能成功建置——即使專案裡有別的檔案型別有誤（例如另一個模組還在開發中），
 * 這支腳本仍然讀得懂它自己在乎的那一小塊語法。路徑 2 的型別標註比對只認文字，不是真的型別
 * 檢查：把參數標成 `TransactionRunner` 卻塞一個裸連線池進來，那是編譯器的事（見上文），
 * 不是這支腳本要重複把關的事。
 *
 * ## §7.2 自我檢查：命中 0 個 `recordAudit` 呼叫點必須失敗
 *
 * 與 `check:tz-leak`／`check-number-cast` 同一個理由：`modules/` 搬家、`recordAudit` 改名、
 * 呼叫點被清空，這支腳本會照跑、照綠、零命中，而「稽核必須在交易內」這條規則就在沒有人
 * 察覺的情況下失效了。**不寫死「至少 N 個呼叫點」的下限**——那個數字會在每次合法新增稽核
 * 呼叫點時要求維護者回來改這支腳本，改到後來不會再有人真的去看那個數字對不對，
 * 唯一站得住腳的下限是「> 0」。另外用一份內建樣本驗證判斷邏輯本身還認得出正確與錯誤的形狀
 * （不依賴 repo 現況，即使有一天全專案的呼叫點都寫對了，這一項仍然證明得了腳本擋得住東西）。
 *
 * 執行：`bun run check:audit-transaction`（已串進 `bun run ci`，緊接在 `check:audit-policy` 之後）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：腳本從哪個目錄被呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** 規則的定義域：`recordAudit` 只可能被業務模組呼叫，`modules/` 以外沒有任何合法呼叫點。 */
const SCAN_ROOT = join(API_ROOT, 'src/modules')

/** 要掃的呼叫函式名。與 `modules/audit/main/audit-main.service.ts` 匯出的名字一致。 */
const RECORD_AUDIT_NAME = 'recordAudit'

/** 交易方法名。與 `db/client.ts` 的 `Database['transaction']` 一致（含 `TenantDatabase` 之外的裸連線）。 */
const TRANSACTION_METHOD_NAME = 'transaction'

/** 一則違規。位置一律寫成 `專案相對路徑:行號:欄號`，讓人可以直接跳過去改（§7.2）。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly detail: string
}

/**
 * 直接把整支腳本判為不可信並中止。寫成 function 宣告而不是箭頭函式，
 * 是為了讓 TypeScript 的控制流分析認得 `never`（同 `check-audit-policy.ts`／`check-number-cast.ts`）。
 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 位置一律寫成 `apps/api 相對路徑`，與 `check-audit-policy.ts` 的 `locate()` 同一種格式。 */
const repoPath = (absolutePath: string): string => relative(API_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 判斷邏輯（純函式，下面的自我檢查會拿它去跑內建樣本）
// ---------------------------------------------------------------------------

/** 是不是 `<something>.transaction(...)` 這種呼叫。 */
const isTransactionCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === TRANSACTION_METHOD_NAME

/**
 * `.transaction(callback)` 的回呼第一個參數名。
 *
 * 回呼必須是箭頭函式或一般函式常值（`context.db.transaction(someNamedFunction)` 這種
 * 傳既有函式參照的寫法，目前整個專案沒有出現——真的出現時，第一個參數名在呼叫點看不到，
 * 只能判定為找不到，交由呼叫端往上一層 `.transaction(...)` 繼續找，或者最終落到違規，
 * 這比「猜一個名字」安全）。解構參數（`({ ... }) => ...`）同理回傳 `null`：
 * `recordAudit` 的第一個引數本來就必須是單一識別字，不可能等於一個解構出來的名字。
 */
const transactionCallbackParamName = (call: ts.CallExpression): string | null => {
  const callback = call.arguments[0]
  if (callback === undefined) return null
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null
  const firstParam = callback.parameters[0]
  if (firstParam === undefined || !ts.isIdentifier(firstParam.name)) return null
  return firstParam.name.text
}

/**
 * 從 `recordAudit(...)` 呼叫節點沿 `parent` 鏈往上走，找一個回呼參數名等於 `argumentName`
 * 的 `.transaction(...)`。**刻意走到檔案頂端才放棄**，不是只看最近的一層 `CallExpression`
 * ——`recordAudit` 有可能被包在其他非交易的呼叫（例如一個小工具函式）裡面，
 * 那一層本身不是 `transaction`，但再往上一層可能才是真正的交易邊界。
 */
const hasEnclosingTransactionMatch = (call: ts.CallExpression, argumentName: string): boolean => {
  let current: ts.Node | undefined = call.parent
  while (current !== undefined) {
    if (isTransactionCall(current) && transactionCallbackParamName(current) === argumentName) return true
    current = current.parent
  }
  return false
}

/** 是不是函式（箭頭函式、一般函式常值、函式宣告）——`enclosingFunctionAcceptsHandle` 找的就是這三種。 */
const isFunctionLike = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)

/**
 * 型別標註文字裡有沒有 `TransactionRunner`。只做字串比對，不解析型別——理由見檔頭
 * 「只走語法樹，不做型別解析」那一段：這裡要問的是「這個參數看起來像不像收了交易 handle」，
 * 不是「這個型別實際上是什麼」，後者已經是編譯器的事。用單詞邊界（`\b`）避免誤配到
 * 例如 `MyTransactionRunnerWrapper` 這種名字包含它但語意不同的型別。
 */
const isTransactionRunnerAnnotation = (typeNode: ts.TypeNode | undefined): boolean =>
  typeNode !== undefined && /\bTransactionRunner\b/.test(typeNode.getText())

/**
 * 路徑 2（計畫 §4.1 之後新增）：`recordAudit(...)` 是不是「直接包住它的那個函式」的第一個參數
 * ——且那個參數的型別標註含有 `TransactionRunner`。
 *
 * **只看最近一層函式，不像 {@link hasEnclosingTransactionMatch} 會一路往上找到檔案頂端**：
 * 計畫 §4.1 定案「交易 handle 一律是第一個參數」，可信的 handle 只可能來自呼叫點所在函式
 * 自己的簽章。如果往上一路找的話，一個無關的外層函式剛好也有個叫同樣名字、標成
 * `TransactionRunner` 的第一參數，會被誤判為合法——那正是「兩個不同 handle」這個規則要擋的
 * 那種混淆的放大版。
 *
 * 解構參數（`({ tx }: ...) => ...`）回傳 `false`：`recordAudit` 的第一個引數本來就必須是
 * 單一識別字，不可能等於一個解構出來的名字（與 {@link transactionCallbackParamName} 同一個理由）。
 */
const enclosingFunctionAcceptsHandle = (call: ts.CallExpression, argumentName: string): boolean => {
  let current: ts.Node | undefined = call.parent
  while (current !== undefined) {
    if (isFunctionLike(current)) {
      const firstParam = current.parameters[0]
      if (firstParam === undefined || !ts.isIdentifier(firstParam.name)) return false
      return firstParam.name.text === argumentName && isTransactionRunnerAnnotation(firstParam.type)
    }
    current = current.parent
  }
  return false
}

/** 一個檔案的掃描結果：違規清單 ＋ 命中的 `recordAudit(` 呼叫總數（自我檢查要用後者）。 */
type FileScanResult = {
  readonly violations: readonly Violation[]
  readonly callCount: number
}

/** 掃單一檔案（或內建樣本字串）裡的 `recordAudit(` 呼叫。 */
const scanSource = (code: string, file: string): FileScanResult => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []
  let callCount = 0

  const record = (node: ts.Node, detail: string): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file,
      line: line + 1,
      column: character + 1,
      source: node.getText(sourceFile).split('\n')[0]?.trim() ?? '',
      detail,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === RECORD_AUDIT_NAME) {
      callCount += 1
      const firstArgument = node.arguments[0]

      if (firstArgument === undefined || !ts.isIdentifier(firstArgument)) {
        record(
          node,
          `第一個引數必須是交易回呼的參數（一個識別字，例如 tx），實際是 ` +
            `${firstArgument === undefined ? '（缺少引數）' : firstArgument.getText(sourceFile)}`,
        )
      } else if (
        !hasEnclosingTransactionMatch(node, firstArgument.text) &&
        !enclosingFunctionAcceptsHandle(node, firstArgument.text)
      ) {
        record(
          node,
          `recordAudit(${firstArgument.text}, ...) 既找不到把它包起來、且回呼參數名為 ` +
            `${firstArgument.text} 的 .transaction(...)，也不是所在函式第一個型別標註為 ` +
            `TransactionRunner 的參數——稽核用的可能不是這次業務寫入真正在用的那個交易 handle`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { violations, callCount }
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有 `.ts` 檔（含 `__tests__`：測試裡的 `recordAudit(` 呼叫一樣要守規則）。 */
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

const files = listFiles(SCAN_ROOT)

const violations: Violation[] = []
let totalCallCount = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = scanSource(source, repoPath(file))
  violations.push(...result.violations)
  totalCallCount += result.callCount
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 內建樣本涵蓋七種形狀，涵蓋路徑 1（詞法巢狀）與路徑 2（收外部 handle，計畫 §4.1）：
 *
 * 1. `ok`：`recordAudit(tx, ...)` 直接包在 `context.db.transaction(async (tx) => ...)` 裡
 *    → 合法（路徑 1）。
 * 2. `propertyAccessArg`：第一個引數是 `context.db`（屬性存取，不是識別字）→ 違規，
 *    即使外層真的有一個交易——**這個形狀現在其實已經被型別系統擋住**（`recordAudit` 收
 *    `TransactionRunner`，連線池塞不進去），這裡留著是為了證明「引數不是單一識別字」
 *    這條判斷本身沒有壞掉，不是說這個 repo 裡真的還會出現這種寫法。
 * 3. `unwrapped`：第一個引數是識別字，但整個呼叫既沒有被任何 `.transaction(...)` 包住，
 *    也不是所在函式標成 `TransactionRunner` 的第一個參數 → 違規。
 * 4. `mismatchedParamName`：有外層交易，但交易回呼的參數叫 `trx`，`recordAudit` 卻傳了 `tx`
 *    （形跡可疑：多半是複製貼上時漏改）→ 違規（路徑 1 不成立，路徑 2 也不成立——`tx` 不是
 *    這個函式自己的參數）。
 * 5. `nestedThroughNonTransactionCall`：`recordAudit(tx, ...)` 中間隔了一層不相關的呼叫
 *    （`doSomethingElse(async () => ...)`）才到得了外層的 `.transaction(async (tx) => ...)`
 *    → 合法（路徑 1），用來證明「往上走到檔案頂端才放棄」這件事真的有實作，不是只看最近一層。
 * 6. `inTransactionHandle`：函式**不開交易**，第一個參數是 `tx: TransactionRunner`，
 *    `recordAudit(tx, ...)` 直接用這個參數 → 合法（路徑 2）——這正是計畫 §4.1 之後、
 *    `employees/main` 等模組的 `impl/*.service.ts` 實際採用的形狀。
 * 7. `twoDifferentHandles`：函式收了兩個交易 handle（`tx`、`otherTx`，兩個都合法標成
 *    `TransactionRunner`），業務寫入該用的是第一個參數 `tx`，`recordAudit` 卻手滑傳了
 *    `otherTx` → 違規（路徑 2 要求用的必須是**第一個**參數，`otherTx` 不是）。這是型別系統
 *    擋不住、只有這支腳本才擋得住的那種情況——兩個引數型別上都合法，但不是同一個交易，
 *    示範見檔頭「型別系統擋不住的，換這支腳本頂上」那一段。
 *
 * 預期：7 個呼叫點，其中 4 個違規（2、3、4、7）。
 */
const SELF_TEST_SAMPLE = [
  'async function ok() {',
  '  await context.db.transaction(async (tx) => {',
  '    await recordAudit(tx, input)',
  '  })',
  '}',
  'async function propertyAccessArg() {',
  '  await context.db.transaction(async (tx) => {',
  '    await recordAudit(context.db, input)',
  '  })',
  '}',
  'async function unwrapped() {',
  '  const db = context.db',
  '  await recordAudit(db, input)',
  '}',
  'async function mismatchedParamName() {',
  '  await context.db.transaction(async (trx) => {',
  '    await recordAudit(tx, input)',
  '  })',
  '}',
  'async function nestedThroughNonTransactionCall() {',
  '  await context.db.transaction(async (tx) => {',
  '    await doSomethingElse(async () => {',
  '      await recordAudit(tx, input)',
  '    })',
  '  })',
  '}',
  'async function inTransactionHandle(tx: TransactionRunner, context, input) {',
  '  await recordAudit(tx, input)',
  '}',
  'async function twoDifferentHandles(tx: TransactionRunner, otherTx: TransactionRunner) {',
  '  await recordAudit(otherTx, input)',
  '}',
].join('\n')

const SELF_TEST_EXPECTED_CALL_COUNT = 7
const SELF_TEST_EXPECTED_VIOLATIONS = 4

const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個檔案（${repoPath(SCAN_ROOT)}）：目錄可能搬家了，這次掃描等於沒跑`)
}

// 命中 0 個 recordAudit( 呼叫點必須失敗（§7.2 的核心要求，見檔頭）：模組改名、目錄搬家、
// recordAudit 本身改名之後，這支腳本會照跑、照綠、零命中，規則等於靜靜消失。
if (totalCallCount === 0) {
  selfCheckFailures.push(
    `${repoPath(SCAN_ROOT)} 底下找不到任何 ${RECORD_AUDIT_NAME}( 呼叫：` +
      '規則的檢查對象消失了，這次掃描等於沒跑（也可能是函式改名，本腳本沒有跟著更新）',
  )
}

const selfTestResult = scanSource(SELF_TEST_SAMPLE, '<self-test>')
if (selfTestResult.callCount !== SELF_TEST_EXPECTED_CALL_COUNT) {
  selfCheckFailures.push(
    `內建樣本應找到 ${String(SELF_TEST_EXPECTED_CALL_COUNT)} 個 ${RECORD_AUDIT_NAME}( 呼叫，` +
      `實際 ${String(selfTestResult.callCount)} 個：呼叫點的辨識邏輯已經失效`,
  )
}
if (selfTestResult.violations.length !== SELF_TEST_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `內建樣本應命中 ${String(SELF_TEST_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestResult.violations.length)} 則：交易包裹的判斷邏輯已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort([
    '稽核交易掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `recordAudit 用的必須是這次業務寫入真正在用的那個交易 handle` +
        `（${String(violations.length)} 處違規，稽核計畫的三個硬規則之一）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：確認 recordAudit 的第一個引數是下面兩者之一——',
      '  1. 包住它的 .transaction(async (tx) => ...) 的那個 tx（名字不必是 tx，只要是同一個），或',
      '  2. 所在函式自己的第一個參數，且該參數型別標成 TransactionRunner（計畫 §4.1「收外部交易',
      '     handle」的形狀，例如 createXxxInTransaction(tx: TransactionRunner, context, input)）。',
      '「傳裸連線池」現在是編譯錯誤（recordAudit 收 TransactionRunner，QueryRunner 擋不住這件事，',
      '但裸連線池不滿足 TransactionRunner），tsc 會先擋下來，不需要這支腳本。這支腳本擋的是',
      '兩個引數型別上都合法、但不是同一個交易的情形（例如把 recordAudit 的 tx 打成另一個變數名）',
      '——理由完整寫在 apps/api/scripts/check-audit-transaction.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `稽核交易檢查通過：${String(files.length)} 個檔案，${String(totalCallCount)} 處 ${RECORD_AUDIT_NAME}( 呼叫，` +
    '全部用的是可信的交易 handle。\n',
)
