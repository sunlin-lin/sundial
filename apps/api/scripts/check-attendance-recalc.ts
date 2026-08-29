/**
 * 出勤重算掃描：任何寫入 `attendance_records` 的呼叫，都必須在**同一個函式、同一個交易 handle**
 * 底下也呼叫 `recalculateAttendanceResultForWorkDay`（計畫 `docs/plans/06-attendance.md` §4.3.1
 * 定案「兩種撤銷之後都要重算」的延伸——這支腳本擋的是「所有寫入路徑都要重算」，不只撤銷）。
 *
 * ## 為什麼要擋：這件事剛剛真的發生過
 *
 * Stage 4 把 `attendance_results` 的重算接上了 `revoke`（本人撤銷）與 `revoke-other`
 * （他人撤銷）兩支 service，**漏了 `create`（打卡）**——正常上下班打卡寫入成功，
 * `attendance_results` 卻永遠沒有那一天的紀錄，因為唯一會觸發重算的路徑是撤銷。UI 09
 * 「全體出勤」因此一片空白，而唯一讓判定結果出現的方法是去撤銷一筆打卡：這是完全反過來的行為。
 * **失敗模式是靜默的**：寫入成功、判定沒更新、畫面上一切正常、`bun run ci` 全綠——沒有任何一層
 * 會報錯，因為「寫入」與「重算」在型別上是兩支互不相干的函式，編譯器不知道它們之間有耦合關係。
 * （`create` 現在已經補上，見 `attendance-records.create.service.ts` 檔頭「打卡成功後……」。）
 *
 * 這條規則不是寫給現在這三支 service 收尾用的。`attendance_records` 目前有三條合法寫入路徑
 * （打卡、本人撤銷、他人撤銷），計畫 06 §4.7 已經預告第四條——Stage 8 補打卡申請核准會建立正式
 * 的打卡紀錄，那也必須在同一筆交易內重算。目前唯一的防線是「寫這支 service 的人記得抄
 * `revoke.service.ts` 的形狀」，這支腳本把「記得」換成「掃描器擋」。
 *
 * ## 判準：兩階段，AST，不是正則
 *
 * 純文字掃描沒辦法回答「這兩個呼叫是不是在同一個函式裡、傳的是不是同一個識別字」——縮排、換行、
 * 巢狀深度在每個呼叫點都不同。因此走 TypeScript 的 AST（`ts.createSourceFile`），不建
 * `ts.Program`（理由與 `check-audit-transaction.ts` 檔頭「只走語法樹，不做型別解析」一致：
 * 這裡要問的是「程式碼長什麼樣子」，不是「這個識別字的型別是什麼」）。
 *
 * ### 第一階段：什麼叫「寫入 `attendance_records` 的呼叫」
 *
 * 不能靠函式名稱白名單——`insertAttendanceRecord`／`markAttendanceRecordRevoked` 這兩個名字
 * 本身不是規則，只是現況，Stage 8 很可能會加一支新的 repository 函式，名字猜不到。改成從
 * **實際寫入這張表**的位置反推：掃描 `src/modules` 底下所有 `*.repository.ts`（只鎖定這個
 * 副檔名，理由見下段），找 `<任意識別字>.insert(attendanceRecords, ...)`／
 * `.update(attendanceRecords, ...)`／`.insertMany(attendanceRecords, ...)`／
 * `.delete(attendanceRecords, ...)` 這四種呼叫——涵蓋 `TenantDatabase`（`db/client.ts`）封裝的
 * 方法名，也涵蓋裸 drizzle chain 寫法（`db.insert(attendanceRecords).values(...)`），兩者的
 * 呼叫方法名與第一個引數形狀相同，見下方 `isAttendanceRecordsWriteCall`。找到之後取出
 * **直接包住這個呼叫的具名函式**（例如 `export const insertAttendanceRecord = async (...) =>
 * {...}` 裡的 `insertAttendanceRecord`），把這個名字收進「寫入函式名單」。
 *
 * **只鎖定 `*.repository.ts`：** 測試檔（`__tests__/*.test.ts`）會用
 * `database.insert(attendanceRecords).values({...})` 直接灌測試固定資料，那組呼叫方法名與
 * 表識別字與正式寫入路徑完全相同，但那是測試資料本身，不是要被守的業務寫入路徑——鎖定副檔名
 * 把它排除在第一階段掃描之外（第二階段仍然掃描含測試檔在內的所有檔案，只是「寫入函式名單」
 * 不會把測試檔裡的東西收進去，所以測試檔裡那些呼叫不會被當成「呼叫點」比對）。
 *
 * 第二階段掃「寫入函式名單」裡每個名字在 `src/modules` 底下的呼叫點（`CallExpression`，callee
 * 是同名 `Identifier`）——這一步涵蓋今天的三條路徑，也自動涵蓋 Stage 8 如果選擇重用既有
 * repository 函式的情況。**抓不到什麼**：Stage 8 如果另外寫一支全新的 repository 函式、且那支
 * 函式不透過上述四種 drizzle 方法寫入這張表（例如組原生 SQL 字串執行）——這支腳本假設全專案的
 * 資料寫入一律經過 drizzle 的 `insert`／`update`／`insertMany`／`delete`
 * （`references/database.md` 沒有例外），這件事本身沒有工具在擋，是這支腳本繼承的既有假設，
 * 不是這一輪新產生的缺口。
 *
 * ### 第二階段：這個呼叫點合不合格
 *
 * 每一個寫入呼叫點，第一個引數必須是一個識別字（交易 handle，通常叫 `tx`）——不是的話直接判
 * 違規（多半是傳了 `context.db` 這種屬性存取，代表根本不在交易裡）。接著在**直接包住這個呼叫的
 * 具名函式**（箭頭函式、一般函式、函式宣告，同一顆節點，不含更外層）範圍內，尋找
 * `recalculateAttendanceResultForWorkDay(...)` 的呼叫（含巢狀在 `if`／區塊內的，見自我檢查
 * 樣本 `nestedRecalc`），且它的第一個引數（同樣要求是識別字）文字必須與寫入呼叫的第一個引數
 * **完全相同**。找不到相符的分三種情況判違規，訊息分開給：
 *
 * 1. 同一個函式內完全沒有 `recalculateAttendanceResultForWorkDay(` 呼叫——寫入但漏了重算，
 *    Stage 4 那次事故的原型。
 * 2. 同一個函式內有，但引數是別的識別字——兩個都是合法識別字，但不是同一筆交易，與
 *    `check-audit-transaction.ts` 的「兩個不同 handle」是同一種混淆。
 * 3. 整個檔案裡有 `recalculateAttendanceResultForWorkDay(` 呼叫，但不在寫入呼叫所在的函式範圍
 *    內——多半是重算寫在開交易的外層函式，而不是交易回呼／收外部 handle 那個函式內部。
 *
 * **與 `check-audit-transaction.ts` 共用的判斷邏輯**：兩支腳本都在回答「這個呼叫的第一個引數，
 * 是不是與另一個呼叫的第一個引數指向同一個交易 handle」，都用「識別字文字是否相同」當判準，
 * 不解析型別。差別在比對對象：那支腳本比對「呼叫」與「包住它的 `.transaction(...)` 回呼參數
 * 或所在函式的第一個參數」，這支腳本比對的是**兩個呼叫彼此**（寫入呼叫 vs 重算呼叫）——規則
 * 問的是「兩個呼叫是不是同一筆交易」，不是「這個呼叫是不是在交易裡」。判斷「是不是函式節點」
 * 的 `isFunctionLike` 邏輯兩邊相同，但各自宣告一份小函式（不到十行）：`check-audit-transaction.ts`
 * 沒有 `export` 任何內部函式（它是一支獨立可執行腳本，不是共用模組），這一輪的容許清單也不含
 * 「修改 `check-audit-transaction.ts` 替它的內部函式加 `export`」，因此在語意上借用同一套判斷
 * 思路，程式碼各自維護——真正該共用、也真正共用了的是這套「識別字文字比對、不解析型別」的判斷
 * 方法本身，不是某一段可以原封不動搬過來的函式實作。
 *
 * ## §7.2 自我檢查
 *
 * 掃到 0 個寫入呼叫點必須失敗（與 `check-audit-transaction.ts` 同一個理由：`modules/` 搬家、
 * 表改名、`TenantDatabase` 方法改名都會讓這支腳本照跑、照綠、零命中，而「寫入必須同交易重算」
 * 這條規則就在沒有人察覺的情況下失效了）。另外用三份內建樣本分別驗證：第一階段（從
 * `.insert(attendanceRecords, ...)` 這類呼叫反推寫入函式名單，含 2 種不該被收進去的形狀）；
 * 第二階段的「完全沒重算」這一種違規（獨立成一份樣本，理由見該樣本的檔頭——與其他違規擠在
 * 同一份檔案裡會讓訊息分類本身變得不準）；第二階段其餘 3 種違規與 3 種合法形狀。三段邏輯
 * 都不依賴 repo 現況，即使有一天全專案的呼叫點都寫對了，這一項仍然證明得了腳本擋得住東西。
 *
 * 執行：`bun run check:attendance-recalc`（已串進 `bun run ci`，緊接在 `check:menu-permission`
 * 之後）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：腳本從哪個目錄被呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** 規則的定義域：業務寫入只可能發生在業務模組裡，`modules/` 以外沒有任何合法呼叫點。 */
const SCAN_ROOT = join(API_ROOT, 'src/modules')

/** 要守的表。與 `db/schema/attendance-records.ts` 匯出的 drizzle 表識別字一致。 */
const WRITTEN_TABLE_IDENTIFIER = 'attendanceRecords'

/** 視為「寫入」的方法名——涵蓋 `TenantDatabase`（`db/client.ts`）封裝的三個方法，
 * 外加裸 drizzle chain 也會用到的 `delete`（`TenantDatabase.delete` 同名）。 */
const WRITE_METHOD_NAMES = new Set(['insert', 'update', 'insertMany', 'delete'])

/** 重算函式名。與 `modules/attendance/results/attendance-results.service.ts` 匯出的名字一致。 */
const RECALC_FUNCTION_NAME = 'recalculateAttendanceResultForWorkDay'

/** 一則違規。位置一律寫成 `專案相對路徑:行號:欄號`，讓人可以直接跳過去改（§7.2）。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly detail: string
}

/** 直接把整支腳本判為不可信並中止（同 `check-audit-transaction.ts`）。 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 位置一律寫成 `apps/api 相對路徑`，與 `check-audit-transaction.ts` 的 `repoPath()` 同一種格式。 */
const repoPath = (absolutePath: string): string => relative(API_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 判斷邏輯（純函式，下面的自我檢查會拿它去跑內建樣本）
// ---------------------------------------------------------------------------

/** 是不是函式（箭頭函式、一般函式常值、函式宣告）——與 `check-audit-transaction.ts` 的
 * `isFunctionLike` 判斷思路相同，各自宣告一份的理由見檔頭「與 check-audit-transaction.ts
 * 共用的判斷邏輯」。 */
const isFunctionLike = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)

/** 從一個節點沿 `parent` 鏈往上走，找**直接包住它**的第一個函式節點。只看最近一層——與
 * `check-audit-transaction.ts` 的 `enclosingFunctionAcceptsHandle` 同一個理由：可信的比對範圍
 * 只能是呼叫點自己所在的那個函式，不是任意外層。 */
const nearestEnclosingFunction = (
  node: ts.Node,
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (isFunctionLike(current)) return current
    current = current.parent
  }
  return undefined
}

/** 函式的「名字」：函式宣告用自己的名字；`export const name = (...) => {...}` 用外層變數宣告的
 * 名字。找不到就回傳 `null`（例如直接當參數傳的匿名函式）——這種情況下這個名字不會被收進
 * 「寫入函式名單」，因為呼叫點永遠是用一個識別字呼叫，不可能呼叫一個沒有名字的函式。 */
const functionName = (fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration): string | null => {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null
  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return null
}

/**
 * 是不是 `<obj>.insert(attendanceRecords, ...)` 這一類寫入呼叫——`obj` 可以是任何識別字
 * （`tenant`、裸的 `db`……都算），只認方法名與第一個引數。第一個引數必須是識別字且文字等於
 * {@link WRITTEN_TABLE_IDENTIFIER}：`TenantDatabase` 封裝與裸 drizzle chain 在這一點的呼叫形狀
 * 相同（`tenant.insert(attendanceRecords, fn)` 與 `db.insert(attendanceRecords).values(...)`
 * 的第一個引數都是 `attendanceRecords`），因此不需要分別處理兩種形狀。
 */
const isAttendanceRecordsWriteCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  WRITE_METHOD_NAMES.has(node.expression.name.text) &&
  node.arguments[0] !== undefined &&
  ts.isIdentifier(node.arguments[0]) &&
  node.arguments[0].text === WRITTEN_TABLE_IDENTIFIER

/** 是不是 `recalculateAttendanceResultForWorkDay(...)` 呼叫。 */
const isRecalcCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === RECALC_FUNCTION_NAME

/** 是不是呼叫「寫入函式名單」裡的某個名字。 */
const isNamedWriteCall = (node: ts.Node, writeFunctionNames: ReadonlySet<string>): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && writeFunctionNames.has(node.expression.text)

/** 遞迴走訪一顆子樹，收集所有符合 `predicate` 的節點。第二階段用它在「直接包住寫入呼叫的
 * 函式」這顆子樹內找重算呼叫，也用它在整個檔案的 AST 上找「檔案裡到底有沒有重算呼叫」。 */
const collectNodes = <T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] => {
  const found: T[] = []
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(root, visit)
  return found
}

/** 一個 `recalculateAttendanceResultForWorkDay(...)` 呼叫的第一個引數文字（不是識別字則為
 * `null`——`recalculateAttendanceResultForWorkDay` 的第一個引數本來就必須是交易 handle，
 * 傳別的東西進去本身已經是另一個問題，不需要在這裡假裝比對得出結果）。 */
const recalcCallArgumentName = (call: ts.CallExpression): string | null => {
  const firstArgument = call.arguments[0]
  return firstArgument !== undefined && ts.isIdentifier(firstArgument) ? firstArgument.text : null
}

// ---------------------------------------------------------------------------
// 第一階段：從 `.insert(attendanceRecords, ...)` 這類呼叫，反推「寫入函式名單」
// ---------------------------------------------------------------------------

/** 掃單一個 `*.repository.ts` 檔案（或內建樣本字串），回傳這個檔案裡定義的寫入函式名字。 */
const discoverWriteFunctionNames = (code: string, file: string): ReadonlySet<string> => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (isAttendanceRecordsWriteCall(node)) {
      const enclosing = nearestEnclosingFunction(node)
      const name = enclosing === undefined ? null : functionName(enclosing)
      if (name !== null) names.add(name)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return names
}

// ---------------------------------------------------------------------------
// 第二階段：呼叫點比對
// ---------------------------------------------------------------------------

/** 一個檔案的第二階段掃描結果：違規清單 ＋ 命中的寫入呼叫總數（自我檢查與 §7.2 都要用後者）。 */
type CallSiteScanResult = {
  readonly violations: readonly Violation[]
  readonly writeCallCount: number
}

/** 掃單一檔案（或內建樣本字串）裡「寫入函式名單」的呼叫點，比對同一函式內是否有相符的重算呼叫。 */
const scanCallSites = (code: string, file: string, writeFunctionNames: ReadonlySet<string>): CallSiteScanResult => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []
  let writeCallCount = 0

  const allRecalcCallsInFile = collectNodes(sourceFile, isRecalcCall)

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
    if (isNamedWriteCall(node, writeFunctionNames)) {
      writeCallCount += 1
      const firstArgument = node.arguments[0]

      if (firstArgument === undefined || !ts.isIdentifier(firstArgument)) {
        record(
          node,
          `第一個引數必須是交易 handle（一個識別字，例如 tx），實際是 ` +
            `${firstArgument === undefined ? '（缺少引數）' : firstArgument.getText(sourceFile)}`,
        )
      } else {
        const writeArgumentName = firstArgument.text
        const enclosing = nearestEnclosingFunction(node)
        const recalcCallsInScope = enclosing === undefined ? [] : collectNodes(enclosing, isRecalcCall)
        const matched = recalcCallsInScope.some((call) => recalcCallArgumentName(call) === writeArgumentName)

        if (!matched) {
          if (recalcCallsInScope.length > 0) {
            const otherArguments = [
              ...new Set(recalcCallsInScope.map((call) => recalcCallArgumentName(call) ?? '（非識別字）')),
            ]
            record(
              node,
              `同一個函式內有 ${RECALC_FUNCTION_NAME}(...) 呼叫，但用的識別字是 ` +
                `${otherArguments.join('、')}，不是 ${writeArgumentName}——兩個都是合法識別字，` +
                `但不是同一筆交易`,
            )
          } else if (allRecalcCallsInFile.length > 0) {
            record(
              node,
              `${RECALC_FUNCTION_NAME}(...) 存在於這個檔案裡，但不在這次寫入所在的函式範圍內` +
                `（多半是重算寫在開交易的外層函式，不是交易回呼／收外部 handle 那個函式內部）`,
            )
          } else {
            record(node, `同一個函式內完全沒有 ${RECALC_FUNCTION_NAME}(...) 呼叫，這筆寫入沒有觸發重算`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { violations, writeCallCount }
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有 `.ts` 檔（含 `__tests__`，理由見檔頭「只鎖定 *.repository.ts」段）。 */
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
const repositoryFiles = files.filter((file) => file.endsWith('.repository.ts'))

const writeFunctionNames = new Set<string>()
for (const file of repositoryFiles) {
  const source = readFileSync(file, 'utf8')
  for (const name of discoverWriteFunctionNames(source, repoPath(file))) writeFunctionNames.add(name)
}

const violations: Violation[] = []
let totalWriteCallCount = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = scanCallSites(source, repoPath(file), writeFunctionNames)
  violations.push(...result.violations)
  totalWriteCallCount += result.writeCallCount
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 第一階段的內建樣本：模擬一支 `*.repository.ts` 的內容，涵蓋四種該被收進「寫入函式名單」的
 * 形狀（`insert`／`update`／`insertMany`／`delete`）與兩種不該被收進去的形狀：
 *
 * - `findThing`：只有 `selectFrom`，不是寫入 → 不該出現在名單裡。
 * - `insertOtherTable`：呼叫 `.insert(...)`，但寫的是別的表（`otherTable`，不是
 *   `attendanceRecords`）→ 不該出現在名單裡，證明判準真的認表名，不是只認方法名。
 *
 * 預期名單：`{ insertThing, updateThing, deleteThing, bulkInsertThing }`，共 4 個。
 */
const SELF_TEST_REPOSITORY_SAMPLE = [
  'export const insertThing = async (runner, companyId, record) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  await tenant.insert(attendanceRecords, (scopedCompanyId) => ({ ...record, companyId: scopedCompanyId }))',
  '}',
  'export const updateThing = async (runner, companyId, id, patch) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  await tenant.update(attendanceRecords, patch, eq(attendanceRecords.id, id))',
  '}',
  'export const deleteThing = async (runner, companyId, id) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  await tenant.delete(attendanceRecords, eq(attendanceRecords.id, id))',
  '}',
  'export const bulkInsertThing = async (runner, companyId, records) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  await tenant.insertMany(attendanceRecords, (scopedCompanyId) => records)',
  '}',
  'export const findThing = async (runner, companyId, id) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  return tenant.selectFrom(columns, attendanceRecords)',
  '}',
  'export const insertOtherTable = async (runner, companyId, record) => {',
  '  const tenant = new TenantDatabase(runner, companyId)',
  '  await tenant.insert(otherTable, (scopedCompanyId) => ({ ...record, companyId: scopedCompanyId }))',
  '}',
].join('\n')

const SELF_TEST_EXPECTED_WRITE_FUNCTION_NAMES = new Set([
  'insertThing',
  'updateThing',
  'deleteThing',
  'bulkInsertThing',
])

/**
 * 第二階段的內建樣本分兩份字串，理由是「整個檔案裡有沒有其他重算呼叫」本身是判準的一部分
 * （用來分辨「完全沒重算」與「重算寫在別的函式」這兩種違規訊息）——若把兩種情況擠進同一份
 * 樣本，`missingRecalc` 所在的「檔案」會因為樣本裡其他函式剛好也有重算呼叫，被誤判成「重算
 * 存在於檔案裡，只是不在這個函式」，訊息文字對不上它真正要測的情況。分成兩份各自獨立掃描，
 * 兩邊才都是「這份檔案除了正在測的那個違規之外，沒有別的東西會干擾判斷」。
 *
 * **樣本 A（`missingRecalc`）**：整份檔案唯一的函式，`insertThing(tx, ...)` 之後完全沒有任何
 * `recalculateAttendanceResultForWorkDay` 呼叫 → 違規（Stage 4 那次事故的原型：寫入但漏了
 * 重算），且是「同一個函式內完全沒有重算呼叫」這一種訊息，不是「重算寫在別的函式」。
 * 預期：1 個寫入呼叫點，1 則違規。
 */
const SELF_TEST_SERVICE_SAMPLE_MISSING = [
  'async function missingRecalc() {',
  '  await insertThing(tx, input)',
  '}',
].join('\n')

const SELF_TEST_MISSING_EXPECTED_WRITE_CALL_COUNT = 1
const SELF_TEST_MISSING_EXPECTED_VIOLATIONS = 1

/**
 * **樣本 B**：其餘 6 種呼叫點，涵蓋 3 種合法形狀與 3 種違規（不含樣本 A 那一種「完全沒重算」）：
 *
 * 1. `ok`：`insertThing(tx, ...)` 與 `recalculateAttendanceResultForWorkDay(tx, ...)` 在同一個
 *    函式、同一個識別字 → 合法。
 * 2. `okDifferentHandleName`：識別字不是 `tx` 而是 `trx`，但兩邊一致 → 合法（證明判準不是寫死
 *    比對字面 `tx`，而是比對「兩邊是否相同」）。
 * 3. `nestedRecalc`：重算呼叫巢狀在 `if` 區塊裡，不是函式的頂層陳述式 → 合法（第三種合法形狀，
 *    證明搜尋範圍真的是整顆子樹，不是只看函式的直接子陳述式）。
 * 4. `differentHandle`：函式內有重算呼叫，但引數是 `otherTx`，不是寫入用的 `tx` → 違規（兩個
 *    都是合法識別字，但不是同一筆交易）。
 * 5. `insertThingInTransaction`／`createThing`：`insertThing(tx, ...)` 在
 *    `insertThingInTransaction` 裡，重算呼叫卻寫在外層的 `createThing`（透過
 *    `.transaction(...)` 呼叫 `insertThingInTransaction` 之後才執行）→ 違規：重算存在於這份
 *    樣本裡（`createThing` 那一行），但不在寫入所在的函式（`insertThingInTransaction`）範圍內
 *    ——樣本裡其他函式都有各自的重算呼叫，這裡才會走到「重算寫在別的函式」這條訊息，不是
 *    「完全沒重算」。
 * 6. `insertThingBadArg`：第一個引數是 `context.db`（屬性存取，不是識別字）→ 違規。
 *
 * 預期：6 個寫入呼叫點，其中 3 個違規（4、5、6）。
 */
const SELF_TEST_SERVICE_SAMPLE_REST = [
  'async function ok() {',
  '  await insertThing(tx, input)',
  '  await recalculateAttendanceResultForWorkDay(tx, input)',
  '}',
  'async function okDifferentHandleName() {',
  '  await updateThing(trx, input)',
  '  await recalculateAttendanceResultForWorkDay(trx, input)',
  '}',
  'async function nestedRecalc() {',
  '  await insertThing(tx, input)',
  '  if (input.shouldRecalculate) {',
  '    await recalculateAttendanceResultForWorkDay(tx, input)',
  '  }',
  '}',
  'async function differentHandle() {',
  '  await insertThing(tx, input)',
  '  await recalculateAttendanceResultForWorkDay(otherTx, input)',
  '}',
  'async function insertThingInTransaction(tx, input) {',
  '  await insertThing(tx, input)',
  '}',
  'async function createThing(context, input) {',
  '  await context.db.transaction((tx) => insertThingInTransaction(tx, input))',
  '  await recalculateAttendanceResultForWorkDay(tx, input)',
  '}',
  'async function insertThingBadArg(input) {',
  '  await insertThing(context.db, input)',
  '}',
].join('\n')

const SELF_TEST_REST_EXPECTED_WRITE_CALL_COUNT = 6
const SELF_TEST_REST_EXPECTED_VIOLATIONS = 3

const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個檔案（${repoPath(SCAN_ROOT)}）：目錄可能搬家了，這次掃描等於沒跑`)
}

// 命中 0 個寫入呼叫點必須失敗（§7.2 的核心要求，見檔頭）：`modules/` 搬家、寫入函式改名、
// `attendanceRecords` 表識別字改名之後，這支腳本會照跑、照綠、零命中，規則等於靜靜消失。
if (totalWriteCallCount === 0) {
  selfCheckFailures.push(
    `${repoPath(SCAN_ROOT)} 底下找不到任何寫入 ${WRITTEN_TABLE_IDENTIFIER} 的呼叫點：` +
      '規則的檢查對象消失了，這次掃描等於沒跑（也可能是第一階段的判準已經失效）',
  )
}

const selfTestWriteFunctionNames = discoverWriteFunctionNames(SELF_TEST_REPOSITORY_SAMPLE, '<self-test-repository>')
const missingExpectedNames = [...SELF_TEST_EXPECTED_WRITE_FUNCTION_NAMES].filter(
  (name) => !selfTestWriteFunctionNames.has(name),
)
const unexpectedNames = [...selfTestWriteFunctionNames].filter(
  (name) => !SELF_TEST_EXPECTED_WRITE_FUNCTION_NAMES.has(name),
)
if (missingExpectedNames.length > 0 || unexpectedNames.length > 0) {
  selfCheckFailures.push(
    `第一階段內建樣本應找到寫入函式名單 { ${[...SELF_TEST_EXPECTED_WRITE_FUNCTION_NAMES].join(', ')} }，` +
      `實際是 { ${[...selfTestWriteFunctionNames].join(', ')} }：` +
      '從 .insert(attendanceRecords, ...) 這類呼叫反推寫入函式的邏輯已經失效',
  )
}

const selfTestMissingResult = scanCallSites(
  SELF_TEST_SERVICE_SAMPLE_MISSING,
  '<self-test-service-missing>',
  selfTestWriteFunctionNames,
)
if (selfTestMissingResult.writeCallCount !== SELF_TEST_MISSING_EXPECTED_WRITE_CALL_COUNT) {
  selfCheckFailures.push(
    `第二階段內建樣本 A（missingRecalc）應找到 ${String(SELF_TEST_MISSING_EXPECTED_WRITE_CALL_COUNT)} ` +
      `個寫入呼叫點，實際 ${String(selfTestMissingResult.writeCallCount)} 個：呼叫點的辨識邏輯已經失效`,
  )
}
if (selfTestMissingResult.violations.length !== SELF_TEST_MISSING_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `第二階段內建樣本 A（missingRecalc）應命中 ${String(SELF_TEST_MISSING_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestMissingResult.violations.length)} 則：「完全沒重算」的判斷邏輯已經失效`,
  )
}

const selfTestRestResult = scanCallSites(
  SELF_TEST_SERVICE_SAMPLE_REST,
  '<self-test-service-rest>',
  selfTestWriteFunctionNames,
)
if (selfTestRestResult.writeCallCount !== SELF_TEST_REST_EXPECTED_WRITE_CALL_COUNT) {
  selfCheckFailures.push(
    `第二階段內建樣本 B 應找到 ${String(SELF_TEST_REST_EXPECTED_WRITE_CALL_COUNT)} 個寫入呼叫點，` +
      `實際 ${String(selfTestRestResult.writeCallCount)} 個：呼叫點的辨識邏輯已經失效`,
  )
}
if (selfTestRestResult.violations.length !== SELF_TEST_REST_EXPECTED_VIOLATIONS) {
  selfCheckFailures.push(
    `第二階段內建樣本 B 應命中 ${String(SELF_TEST_REST_EXPECTED_VIOLATIONS)} 則違規，` +
      `實際 ${String(selfTestRestResult.violations.length)} 則：同函式同識別字的比對邏輯已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort([
    '出勤重算掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `寫入 ${WRITTEN_TABLE_IDENTIFIER} 的呼叫，必須在同一個函式、同一個交易 handle 底下呼叫 ` +
        `${RECALC_FUNCTION_NAME}（${String(violations.length)} 處違規）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：在同一個函式內，緊接著這次寫入呼叫，加上一次 recalculateAttendanceResultForWorkDay，',
      '第一個引數用與寫入呼叫相同的那個交易 handle（通常是 tx）——比照',
      'apps/api/src/modules/attendance/records/impl/attendance-records.revoke.service.ts 的形狀。',
      '理由完整寫在 apps/api/scripts/check-attendance-recalc.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `出勤重算檢查通過：${String(files.length)} 個檔案，${String(writeFunctionNames.size)} 支寫入函式` +
    `（${[...writeFunctionNames].join('、')}），${String(totalWriteCallCount)} 處呼叫點，` +
    '全部在同一筆交易內完成重算。\n',
)
