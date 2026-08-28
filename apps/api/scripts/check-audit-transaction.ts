/**
 * 稽核交易掃描：每一處 `recordAudit(` 呼叫的第一個引數，必須是包住它的
 * `.transaction(async (X) => ...)` 回呼的參數名（稽核計畫的三個硬規則之一）。
 *
 * ## 為什麼型別擋不住這件事，需要一支腳本
 *
 * `db/client.ts` 的 `QueryRunner` 是 `Pick<Database, 'select' | 'selectDistinct' | 'insert' |
 * 'update' | 'delete'>`，而且**連線池與交易物件都滿足它**——這是刻意的（見該檔頭），為了讓
 * repository 在交易內外用同一套寫法。代價是 `recordAudit` 的簽章收的正是這個 `QueryRunner`，
 * 於是 `recordAudit(context.db, ...)` 與 `recordAudit(tx, ...)` 在編譯器眼裡**完全等價**——
 * 一個是裸連線池、一個是交易，型別系統分不出來。而稽核與業務寫入不在同一交易的後果，
 * `sessions-main.revoke-on-reuse.service.ts` 的檔頭已經寫死：沒有交易的兩次寫入有四種結果，
 * 最糟的是「業務寫入失敗、稽核卻成功」——庫裡會留一筆說「已經處理」的紀錄，但實際上什麼都
 * 沒發生，而查稽核的人會就此結案、不會再想到要重做一次。
 *
 * 唯一的整合測試（`sessions-main.revoke-on-reuse.test.ts` 的「★ 故意讓稽核失敗」）驗的是
 * **手工重組的複本**，不是 `revokeChainsOnReuse` 本體——那支測試的檔頭已經誠實寫明這一點：
 * 兩件事（作廢、稽核）在合法輸入下永遠同時成立或同時不成立，沒辦法只從公開介面單獨造出
 * 「作廢成功、稽核失敗」的案例，因此測試改用政策違規當觸發點，繞過了公開簽章。
 * 後果是把 `revoke-on-reuse.service.ts` 裡的 `tx` 換成 `context.db`，那支測試照樣是綠的——
 * 這支腳本補的正是這個洞：不透過執行，直接讀 AST 確認「稽核真的包在交易裡」。
 *
 * ## 判準：AST，不是正則
 *
 * 純文字掃描沒辦法回答「這個呼叫有沒有被某個 `.transaction(...)` 包住」——巢狀的深度、
 * 縮排、換行方式在每個呼叫點都不同，正則要嘛漏判要嘛誤判。因此走 TypeScript 的 AST：
 * 找到 callee 名為 `recordAudit` 的 `CallExpression`，取第一個引數（必須是識別字，
 * 不能是 `context.db` 這種屬性存取——那本身就已經是違規，不需要再往上找）；
 * 然後從這個呼叫節點沿 `parent` 鏈往上走，尋找 callee 是 `PropertyAccessExpression`
 * 且屬性名為 `transaction` 的 `CallExpression`，比對它的回呼（第一個引數，箭頭或一般函式）
 * 的第一個參數名是否等於前面取到的識別字。找到相符的就通過；走到檔案頂端都沒找到 → 違規。
 *
 * **只走語法樹，不做型別解析**（不建 `ts.Program`）：這條規則要問的是「程式碼長什麼樣子」，
 * 不是「這個識別字的型別是什麼」，語法層級的答案就是完整答案，也讓這支腳本不必依賴
 * `tsconfig.json` 能不能成功建置——即使專案裡有別的檔案型別有誤（例如另一個模組還在開發中），
 * 這支腳本仍然讀得懂它自己在乎的那一小塊語法。
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
      } else if (!hasEnclosingTransactionMatch(node, firstArgument.text)) {
        record(
          node,
          `recordAudit(${firstArgument.text}, ...) 找不到把它包起來、且回呼參數名為 ` +
            `${firstArgument.text} 的 .transaction(...)——稽核可能沒有跟業務寫入包在同一交易裡`,
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
 * 內建樣本涵蓋五種形狀：
 *
 * 1. `ok`：`recordAudit(tx, ...)` 直接包在 `context.db.transaction(async (tx) => ...)` 裡 → 合法。
 * 2. `propertyAccessArg`：第一個引數是 `context.db`（屬性存取，不是識別字）→ 違規，
 *    即使外層真的有一個交易——這就是本腳本要擋的那個真實漏洞（`QueryRunner` 兩者都收）。
 * 3. `unwrapped`：第一個引數是識別字，但整個呼叫根本沒有被任何 `.transaction(...)` 包住 → 違規。
 * 4. `mismatchedParamName`：有外層交易，但交易回呼的參數叫 `trx`，`recordAudit` 卻傳了 `tx`
 *    （形跡可疑：多半是複製貼上時漏改）→ 違規。
 * 5. `nestedThroughNonTransactionCall`：`recordAudit(tx, ...)` 中間隔了一層不相關的呼叫
 *    （`doSomethingElse(async () => ...)`）才到得了外層的 `.transaction(async (tx) => ...)`
 *    → 合法，用來證明「往上走到檔案頂端才放棄」這件事真的有實作，不是只看最近一層。
 *
 * 預期：5 個呼叫點，其中 3 個違規（2、3、4）。
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
].join('\n')

const SELF_TEST_EXPECTED_CALL_COUNT = 5
const SELF_TEST_EXPECTED_VIOLATIONS = 3

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
      `稽核寫入必須與業務寫入在同一交易內（${String(violations.length)} 處違規，稽核計畫的三個硬規則之一）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：把 recordAudit 的第一個引數換成包住它的 .transaction(async (tx) => ...) 的那個 tx',
      '（或呼叫端既有的交易回呼參數，名字不必是 tx，只要是同一個），不要傳 context.db／db 這種',
      '連線池或裸 runner——QueryRunner 型別本身分不出連線池與交易物件，因此編譯器不會報錯，',
      '這正是需要本腳本的原因，理由完整寫在 apps/api/scripts/check-audit-transaction.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `稽核交易檢查通過：${String(files.length)} 個檔案，${String(totalCallCount)} 處 ${RECORD_AUDIT_NAME}( 呼叫，` +
    '全部包在正確的交易回呼裡。\n',
)
