/**
 * 法規資料集代碼掃描：計畫 §3.1 的表格（唯一來源）↔ `REGULATORY_DATASETS`，雙向比對。
 *
 * **為什麼需要一支腳本，而不是用型別或 review 擋。** `dataset_code` 是一個 `integer`，
 * 而「代碼 ↔ 資料集」這層對應**只存在於人的腦袋與兩份文字裡**：文件一份、常數檔一份、
 * 資料庫裡還有第三份（已經寫進去的歷史資料）。編譯器看得到的只有「這是個數字」，
 * 於是把 `4` 與 `5` 的名稱對調，型別上跟沒動過完全一樣：
 *
 * - **常數檔改了、資料庫不會跟著改**。舊版本資料仍然指向原本的代碼，意義卻已經被改寫，
 *   Payroll 算勞保時拿到健保的金額表，**算出一個看起來完全正常的保費**——沒有例外、沒有 log、
 *   要等到有人核對薪資單才會發現，而那時已經結算好幾期（§3.1 開頭那段警告）。
 * - **這種改動在 review 幾乎必然被放行**。它的 PR 描述會是「僅整理常數排序，無邏輯變更」，
 *   diff 看起來也確實只是換行順序。會擋下它的只有一個逐項比對的機器。
 *
 * 所以 §3.1.2 把這件事指定成掃描器的工作：文件那張表是唯一來源，常數檔必須逐項一致。
 *
 * ## 兩邊各用什麼讀
 *
 * - **常數那一邊讀 AST**（與 `check-audit-policy.ts` 同一套作法）：不 import 它的值，
 *   因為這個檔案由 modules/regulatory 提供、可能還不存在或還在改，靜態 import 會讓
 *   `bun run typecheck` 跟著紅，而那是不相干的紅燈。讀 AST 也順便拿得到行號（通用規範 §7.2）。
 *   至於 `name` 與 `maintenance` 這兩個**值**則是問 checker 而不是讀字面（見 `literalStringValue`），
 *   於是日後改寫成具名常數也照樣讀得到。
 * - **文件那一邊純文字剖析 markdown 表格**：來源就是一張表，沒有更權威的表示法可問。
 *   代價是它對格式敏感，因此**遇到看不懂的列一律中止**（見下一段）。
 *
 * **代價寫在這裡：兩邊的「結構」都必須是字面值寫死的。** 常數檔的展開（`...BASE`）、
 * 計算屬性名（`[CODE]:`），文件表格的合併儲存格、跨行、跳脫的 `|`，這支腳本都讀不到。
 * 因此它遇到讀不懂的東西**一律失敗，不略過**——略過一列的表現會是「檢查通過」，
 * 而被略過的那一列正好可能就是被對調的那一列。
 *
 * ## 名稱逐字比對，不做正規化
 *
 * 不剝空白以外的東西、不忽略全形半形、不做相似度比對。理由與 `check-audit-policy.ts` 同一條：
 * 一旦開始鬆散比對，這支腳本驗證的就不再是「兩份清單相同」，而是「兩份清單長得像」，
 * 而**長得像正是出事那一刻的樣子**——對調過的兩個名稱彼此都很像一個資料集名稱。
 *
 * 執行：`bun run check:dataset-code`（已串進 `bun run ci`）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：腳本從哪個目錄被呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** monorepo 根目錄。這支腳本橫跨 `docs/` 與 `apps/api/`，位置一律以根目錄相對路徑印出才好跳。 */
const REPO_ROOT = resolve(API_ROOT, '../..')

const SRC_ROOT = join(API_ROOT, 'src')

/** 唯一來源：計畫 §3.1 的表格。搬家或改名時這支腳本會失敗而不是靜靜掃不到東西。 */
const DOC_FILE = join(REPO_ROOT, 'docs/plans/01-regulatory-dataset-versioning.md')

/** §3.1 的標題列。只在這一節裡找表格：同一份文件還有別的表（§4.4 的錯誤字典也是 `| code |` 開頭）。 */
const DOC_SECTION_PATTERN = /^###\s+3\.1(?=[\s.]|$)/

/** 同級或更高層的標題就是本節結束；`####` 是子節，仍算在 §3.1 之內。 */
const DOC_SECTION_END_PATTERN = /^#{1,3}\s/

/** 表格第一欄的標題。認標題而不是認「第幾張表」，表格前後多一段文字不會讓這支腳本失準。 */
const DOC_CODE_COLUMN_HEADER = 'code'

/**
 * 空號的寫法（§3.1「7 為什麼是空號而不是遞補」）。
 *
 * 空號**不是一個資料集**，它必須從比對集合裡被排除；同時它**不得**出現在常數檔裡，
 * 因為「7 存在但沒有意義」與「7 是某個資料集」在資料庫裡長得一模一樣。
 */
const DOC_RESERVED_NAME = '保留不使用'

/** 常數檔的位置與匯出名，由計畫 §3.1 定死。 */
const CODE_FILE = join(SRC_ROOT, 'modules/regulatory/datasets/domain/regulatory-dataset-code.ts')
const CODE_EXPORT_NAME = 'REGULATORY_DATASETS'

/** 維護方式只有兩種：自動同步，或 §3.1.1 那個唯一的人工維護例外。 */
const VALID_MAINTENANCE: readonly string[] = ['sync', 'manual']

/** `apps/api/tsconfig.json`：和 `bun run typecheck` 讀同一份設定，掃到的檔案集合才會跟編譯器一致。 */
const TSCONFIG_FILE = join(API_ROOT, 'tsconfig.json')

/** 一則不一致。`code` 讓錯誤訊息指得出是哪一個代碼壞了，而不只是「某處對不上」。 */
type Failure = {
  readonly code: number
  readonly detail: string
}

const failures: Failure[] = []

/**
 * 直接把整支腳本判為不可信並中止：常數檔不存在、文件表格讀不懂這類「掃描前提不成立」的情形。
 *
 * 寫成 function 宣告而不是 const 箭頭函式，是為了讓 TypeScript 的控制流分析認得 `never`
 * ——箭頭函式要另外標注變數型別才有同樣效果，那是更容易在重構時掉的一種寫法。
 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 位置一律寫成 `根目錄相對路徑:行號`，讓人可以直接跳過去改（§7.2）。 */
const repoPath = (absolutePath: string): string => relative(REPO_ROOT, absolutePath).replaceAll('\\', '/')

const docLocation = (lineNumber: number): string => `${repoPath(DOC_FILE)}:${lineNumber}`

const codeLocation = (node: ts.Node): string => {
  const file = node.getSourceFile()
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
  return `${repoPath(file.fileName)}:${line + 1}`
}

// ---------------------------------------------------------------------------
// 讀文件（markdown 表格）
// ---------------------------------------------------------------------------

if (!existsSync(DOC_FILE)) {
  abort([
    '找不到法規資料集計畫文件，這次掃描等於沒跑：',
    `  ✗ ${repoPath(DOC_FILE)}`,
    '    §3.1 的表格是這份清單的唯一來源。文件搬家的話請一併修正本腳本的 DOC_FILE，',
    '    不要把這個檢查停掉——沒有來源可比，常數檔就等於沒有人在看。',
  ])
}

const docLines = readFileSync(DOC_FILE, 'utf8').split(/\r?\n/)

/** markdown 表格的一列：拆好的儲存格 ＋ 它在整份文件裡的行號（錯誤訊息要指得出位置）。 */
type DocRow = {
  readonly cells: readonly string[]
  readonly lineNumber: number
}

/**
 * 把一列表格拆成儲存格。不是表格列時回 `undefined`。
 *
 * 只認「前後都有 `|`」的標準寫法。markdown 允許省略首尾的 `|`，但那種寫法在這裡會被判成
 * 「不是表格列」而落到節內文字，於是整張表可能少讀幾列——所以下面找到表格後會**檢查列數與欄數**，
 * 讓少讀表現成失敗而不是通過。
 */
const splitTableRow = (line: string): readonly string[] | undefined => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

/** 對齊列（`|---|---|`）。它不是資料，但必須確認它在該在的位置，否則表示這張表的形狀跟預期不同。 */
const isSeparatorRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))

// 先切出 §3.1 這一節。整份文件掃的話會撈到 §4.4 的錯誤字典表（它第一欄也叫 `code`），
// 那張表跟資料集無關，比對它只會產生一整串假錯誤。
const sectionStartIndex = docLines.findIndex((line) => DOC_SECTION_PATTERN.test(line))
if (sectionStartIndex === -1) {
  abort([
    `文件裡找不到 §3.1 的標題（比對式：${DOC_SECTION_PATTERN.source}）：`,
    `  ✗ ${repoPath(DOC_FILE)}`,
    '    章節改號或改寫時請一併修正本腳本，否則它會掃不到任何東西。',
  ])
}

const sectionEndOffset = docLines.slice(sectionStartIndex + 1).findIndex((line) => DOC_SECTION_END_PATTERN.test(line))
const sectionEndIndex = sectionEndOffset === -1 ? docLines.length : sectionStartIndex + 1 + sectionEndOffset

// 在節內找出「第一欄標題是 code」的表格。連續的表格列算同一張表，中間隔了非表格列就換一張。
const codeTables: DocRow[][] = []
let currentTable: DocRow[] = []

for (let index = sectionStartIndex; index < sectionEndIndex; index += 1) {
  const line = docLines[index] ?? ''
  const cells = splitTableRow(line)

  if (cells === undefined) {
    // 表格結束：只有標題列第一欄叫 `code` 的那張才是我們要的。
    if (currentTable[0]?.cells[0]?.toLowerCase() === DOC_CODE_COLUMN_HEADER) codeTables.push(currentTable)
    currentTable = []
    continue
  }

  currentTable.push({ cells, lineNumber: index + 1 })
}
if (currentTable[0]?.cells[0]?.toLowerCase() === DOC_CODE_COLUMN_HEADER) codeTables.push(currentTable)

// 恰好一張。零張代表表格被改寫或搬走了；多張代表節內出現了第二份清單，
// 而「該比對哪一份」不能用猜的——猜錯的話比對結果看起來一樣合理。
if (codeTables.length !== 1) {
  abort([
    `文件 §3.1 裡的「| ${DOC_CODE_COLUMN_HEADER} | 資料集 | ... |」表格不是恰好一張（找到 ${codeTables.length} 張）：`,
    `  ✗ ${docLocation(sectionStartIndex + 1)}`,
    '    這張表是唯一來源，找不到或找到多張都代表這支腳本比對的對象已經不確定。',
  ])
}

const docTable = codeTables[0] ?? []
const headerRow = docTable[0]
const separatorRow = docTable[1]

if (headerRow === undefined || separatorRow === undefined || !isSeparatorRow(separatorRow.cells)) {
  abort([
    '文件 §3.1 的表格缺少標題列或對齊列，形狀與預期不同：',
    `  ✗ ${docLocation(headerRow?.lineNumber ?? sectionStartIndex + 1)}`,
    '    預期形狀：`| code | 資料集 | 來源 | 生效日從哪來 |` 後接 `|---|---|---|---|`。',
  ])
}

const columnCount = headerRow.cells.length

/**
 * 剝掉整格被 `**` 包住的強調。空號那一列寫成 `| 7 | **保留不使用** | — | — |`。
 *
 * 只剝「整格包住、且內部沒有第二組 `**`」這一種：`**` 在 markdown 渲染後不會出現在畫面上，
 * 剝掉是還原成讀者看到的字，不是模糊比對。`**a** 與 **b**` 這種格內局部強調不剝——
 * 硬剝會剝出 `a** 與 **b`，那會讓兩個不同的名稱有機會被正規化成同一個。
 */
const stripFullCellEmphasis = (cell: string): string => {
  const match = /^\*\*([^*]+)\*\*$/.exec(cell)
  return (match?.[1] ?? cell).trim()
}

/** 文件側的一項資料集。 */
type DocDataset = {
  readonly name: string
  readonly lineNumber: number
}

const docDatasets = new Map<number, DocDataset>()
/** 空號：不是資料集，但必須記下來——常數檔裡出現它就是錯的。 */
const docReservedCodes = new Map<number, number>()

for (const row of docTable.slice(2)) {
  // 欄數不符通常代表儲存格裡有沒跳脫好的 `|`，或是有人加了一欄。
  // 這種列如果照樣硬讀，第二欄拿到的可能根本不是名稱，而比對結果會是一則假錯誤或假通過。
  if (row.cells.length !== columnCount) {
    abort([
      `文件 §3.1 的表格有一列欄數不對（預期 ${columnCount} 欄，實際 ${row.cells.length} 欄）：`,
      `  ✗ ${docLocation(row.lineNumber)}`,
      `    原文：${docLines[row.lineNumber - 1] ?? ''}`,
      '    這支腳本不猜這一列的意思：猜錯會讓某個代碼對到別人的名稱，而輸出仍然是「檢查通過」。',
    ])
  }

  const codeCell = row.cells[0] ?? ''
  const nameCell = stripFullCellEmphasis(row.cells[1] ?? '')

  // 代碼必須是純數字。寫成 `` `1` `` 或 `1（暫定）` 都會落在這裡：
  // 靜靜略過的話那一項就再也不被比對，而它正好可能是被改動的那一項。
  if (!/^\d+$/.test(codeCell)) {
    abort([
      `文件 §3.1 的表格有一列的代碼不是整數：'${codeCell}'`,
      `  ✗ ${docLocation(row.lineNumber)}`,
      `    原文：${docLines[row.lineNumber - 1] ?? ''}`,
      '    dataset_code 是 integer，第一欄請只寫數字。',
    ])
  }

  const code = Number(codeCell)

  if (docDatasets.has(code) || docReservedCodes.has(code)) {
    abort([
      `文件 §3.1 的表格出現重複的代碼 ${code}：`,
      `  ✗ ${docLocation(row.lineNumber)}`,
      '    一個代碼只能對應一個資料集，重複的話唯一來源自己就是矛盾的。',
    ])
  }

  if (nameCell === DOC_RESERVED_NAME) {
    docReservedCodes.set(code, row.lineNumber)
    continue
  }

  if (nameCell === '') {
    abort([
      `文件 §3.1 的代碼 ${code} 沒有資料集名稱：`,
      `  ✗ ${docLocation(row.lineNumber)}`,
      `    要標成空號請寫 \`**${DOC_RESERVED_NAME}**\`（§3.1「7 為什麼是空號」），空白讀不出意圖。`,
    ])
  }

  // 換句話寫的空號（「保留」「暫時保留」…）會被當成一個叫這個名字的資料集，
  // 於是腳本開始要求常數檔補上它——方向剛好相反。與其猜，不如吵一次。
  if (nameCell.includes('保留')) {
    abort([
      `文件 §3.1 的代碼 ${code} 名稱含「保留」，但不是這支腳本認得的空號寫法：'${nameCell}'`,
      `  ✗ ${docLocation(row.lineNumber)}`,
      `    空號請一律寫成 \`**${DOC_RESERVED_NAME}**\`；若它其實是一個資料集，請換一個不含「保留」的名稱。`,
    ])
  }

  docDatasets.set(code, { name: nameCell, lineNumber: row.lineNumber })
}

// ---------------------------------------------------------------------------
// 掃描前提：常數檔必須存在
// ---------------------------------------------------------------------------

// modules/regulatory 還沒把檔案交出來時，這裡是唯一一個「腳本沒辦法做事」的合法出口。
// 刻意不做成「檔案不在就跳過」：那會讓常數檔被誰刪掉之後 CI 依然全綠。
if (!existsSync(CODE_FILE)) {
  abort([
    '找不到法規資料集代碼常數檔，這次掃描等於沒跑：',
    `  ✗ ${repoPath(CODE_FILE)}`,
    `    這個檔案由 modules/regulatory 提供，形狀見 docs/plans/01-regulatory-dataset-versioning.md §3.1：`,
    `    \`export const ${CODE_EXPORT_NAME} = { 1: { key: '...', name: '...', maintenance: 'sync' }, ... } as const\`。`,
    '    若它已經搬家或改名，請一併修正本腳本的 CODE_FILE，不要把這個檢查停掉。',
  ])
}

// ---------------------------------------------------------------------------
// 建立 program
// ---------------------------------------------------------------------------

const configHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    abort(['讀不到 apps/api/tsconfig.json，常數檔無從解析：', `  ✗ ${message}`])
  },
}

const parsedConfig = ts.getParsedCommandLineOfConfigFile(TSCONFIG_FILE, {}, configHost)

if (parsedConfig === undefined) abort(['讀不到 apps/api/tsconfig.json，常數檔無從解析。'])

// 用 tsconfig 算出來的完整檔案集合建 program，而不是只丟常數檔進去：
// 少了 include 範圍，常數檔 import 的東西會解析不到，checker 對 `name` 這類具名常數會算不出字面量型別。
const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options: parsedConfig.options })
const checker = program.getTypeChecker()

const codeSourceFile = program.getSourceFile(CODE_FILE)
if (codeSourceFile === undefined) {
  abort([
    '常數檔存在，但不在 apps/api/tsconfig.json 的 include 範圍內：',
    `  ✗ ${repoPath(CODE_FILE)}`,
    '    不在範圍內代表它也沒有被 `bun run typecheck` 檢查過。請修正 tsconfig 的 include。',
  ])
}

// ---------------------------------------------------------------------------
// 讀常數（AST）
// ---------------------------------------------------------------------------

/**
 * 剝掉 `as const`／`satisfies`／多餘括號，拿到真正的物件字面值。
 *
 * §3.1 的形狀是 `{ ... } as const`，但日後也可能改寫成 `satisfies RegulatoryDatasetMap`。
 * 不剝的話這兩種寫法會被當成「不是物件字面值」而整支失敗——那是假警報，比漏掉更快被人關掉。
 */
const unwrapExpression = (node: ts.Expression): ts.Expression => {
  let current = node
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

/**
 * 取出一個運算式的靜態字串值，取不到回 `undefined`。
 *
 * **不只認字串字面值，也問 checker**：`maintenance` 日後很可能寫成 `DatasetMaintenance.Sync`
 * 這種具名常數（比裸字串好，因為打錯字當場是編譯錯誤），而那在 AST 上是一個屬性存取，看不出值。
 * checker 對 `as const` 的常數會算出字面量型別，於是兩種寫法都讀得到——**不必逼常數檔改寫成裸字串**。
 * 這一步只用來讀值，結構（有哪些代碼）仍然一律走 AST，理由見檔頭。
 */
const literalStringValue = (node: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(node)) return node.text
  const type = checker.getTypeAtLocation(node)
  return type.isStringLiteral() ? type.value : undefined
}

/** 屬性名只收識別字與字串字面值。計算屬性名（`[CODE]:`）讀不出靜態值，落到這裡回 `undefined` 由呼叫端報錯。 */
const staticPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/**
 * 走訪物件字面值的屬性，**遇到任何非「純字面值屬性」的寫法就中止整支腳本**。
 *
 * 這裡刻意不是「跳過看不懂的節點」：跳過的後果是那一項（或那一批欄位）不再被比對，
 * 而輸出仍然是綠的「檢查通過」——掃描器最危險的失效模式。寧可要一次很吵的失敗。
 */
const literalProperties = (object: ts.ObjectLiteralExpression, context: string): ts.PropertyAssignment[] => {
  const properties: ts.PropertyAssignment[] = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || staticPropertyName(property.name) === undefined) {
      abort([
        `常數檔裡有這支腳本讀不懂的寫法，掃描結果不可信（${context}）：`,
        `  ✗ ${codeLocation(property)}`,
        '    只支援直接寫死的屬性（`1: { ... }`）。展開（...）、計算屬性名（[CODE]:）、簡寫、方法都讀不到，',
        '    而讀不到的部分不會被比對，卻仍然會印出「檢查通過」。請把常數攤平成字面值。',
      ])
    }
    properties.push(property)
  }
  return properties
}

const datasetDeclaration = codeSourceFile.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => statement.declarationList.declarations)
  .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === CODE_EXPORT_NAME)

if (datasetDeclaration?.initializer === undefined) {
  abort([
    `常數檔裡找不到 ${CODE_EXPORT_NAME}：`,
    `  ✗ ${repoPath(CODE_FILE)}`,
    `    預期是 \`export const ${CODE_EXPORT_NAME} = { ... } as const\`（見計畫 §3.1）。`,
  ])
}

const datasetObject = unwrapExpression(datasetDeclaration.initializer)
if (!ts.isObjectLiteralExpression(datasetObject)) {
  abort([
    `${CODE_EXPORT_NAME} 不是直接寫死的物件字面值：`,
    `  ✗ ${codeLocation(datasetObject)}`,
    '    這支腳本靠 AST 讀常數（理由見檔頭），組合出來的值讀不到，會變成「掃不到東西卻通過」。',
  ])
}

/** 常數側的一項資料集。三個 node 是為了讓每一則錯誤都指到出問題的那一行，而不是整項的開頭。 */
type CodeDataset = {
  readonly name: string
  /** 算不出靜態值時為 `undefined`，交給下面的維護方式檢查報錯。 */
  readonly maintenance: string | undefined
  /** 整項（`1: { ... }`）。用於「文件沒有這一項」這種對整項的錯誤。 */
  readonly node: ts.Node
  readonly nameNode: ts.Node
  readonly maintenanceNode: ts.Node
}

const codeDatasets = new Map<number, CodeDataset>()

for (const datasetProperty of literalProperties(datasetObject, CODE_EXPORT_NAME)) {
  const codeText = staticPropertyName(datasetProperty.name) ?? ''

  // key 必須是整數字面值。`dataset_code` 在資料庫是 integer，這裡寫成別的東西
  // 表示常數檔與資料表已經對不起來，而那件事沒有任何型別看得到。
  if (!/^\d+$/.test(codeText)) {
    abort([
      `${CODE_EXPORT_NAME} 的 key 不是整數：'${codeText}'`,
      `  ✗ ${codeLocation(datasetProperty)}`,
      '    key 就是寫進資料庫的 dataset_code，請寫成數字字面值（例如 `1: { ... }`）。',
    ])
  }

  const code = Number(codeText)

  if (codeDatasets.has(code)) {
    abort([
      `${CODE_EXPORT_NAME} 出現重複的代碼 ${code}：`,
      `  ✗ ${codeLocation(datasetProperty)}`,
      '    物件字面值裡重複的 key 後者會蓋掉前者，而 TypeScript 對數字 key 不會報錯。',
    ])
  }

  const datasetValue = unwrapExpression(datasetProperty.initializer)
  if (!ts.isObjectLiteralExpression(datasetValue)) {
    abort([
      `${CODE_EXPORT_NAME}[${code}] 不是物件字面值：`,
      `  ✗ ${codeLocation(datasetValue)}`,
      "    預期形狀：{ key: '...', name: '...', maintenance: 'sync' | 'manual' }。",
    ])
  }

  const entries = new Map(
    literalProperties(datasetValue, `${CODE_EXPORT_NAME}[${code}]`).map((property) => [
      staticPropertyName(property.name) ?? '',
      property,
    ]),
  )

  const nameProperty = entries.get('name')
  const maintenanceProperty = entries.get('maintenance')

  // 兩者都是必要的：name 是拿來跟文件 §3.1 比對的那一份名稱，maintenance 決定它走同步還是人工維護。
  // 缺任一個都不是「這一項比較簡單」，而是這一項沒辦法被檢查。
  if (nameProperty === undefined || maintenanceProperty === undefined) {
    abort([
      `${CODE_EXPORT_NAME}[${code}] 少了必要的 key：`,
      `  ✗ ${codeLocation(datasetValue)}`,
      `    name: ${nameProperty === undefined ? '缺少' : '有'}、maintenance: ${maintenanceProperty === undefined ? '缺少' : '有'}。`,
      "    預期形狀：{ key: '...', name: '...', maintenance: 'sync' | 'manual' }。",
    ])
  }

  const nameNode = unwrapExpression(nameProperty.initializer)
  const name = literalStringValue(nameNode)
  if (name === undefined) {
    abort([
      `${CODE_EXPORT_NAME}[${code}].name 算不出靜態的字串值：`,
      `  ✗ ${codeLocation(nameNode)}`,
      '    名稱要在不執行程式的情況下就看得出來，否則掃描器沒有辦法拿它跟文件比對。',
    ])
  }

  // 維護方式算不出靜態值時記成 `undefined`，交給下面的檢查報錯，不在這裡中止：
  // 它壞掉不影響「代碼與名稱對不對得上」的比對，一次把兩種問題都印出來，人才能一輪修完。
  const maintenance = literalStringValue(unwrapExpression(maintenanceProperty.initializer))

  codeDatasets.set(code, {
    name,
    maintenance,
    node: datasetProperty,
    nameNode,
    maintenanceNode: maintenanceProperty,
  })
}

// ---------------------------------------------------------------------------
// 雙向比對
// ---------------------------------------------------------------------------

for (const [code, docDataset] of docDatasets) {
  const codeDataset = codeDatasets.get(code)

  // 文件有、常數沒有 → 新增的資料集沒有落到程式碼裡，或有人把一整項刪掉了。
  if (codeDataset === undefined) {
    failures.push({
      code,
      detail: [
        `文件有這一項，${CODE_EXPORT_NAME} 沒有：'${docDataset.name}'`,
        `      請在常數檔補上 ${code}: { key: '...', name: '${docDataset.name}', maintenance: ${VALID_MAINTENANCE.join(' | ')} }`,
        `      ${docLocation(docDataset.lineNumber)}`,
      ].join('\n'),
    })
    continue
  }

  // 名稱逐字比對（理由見檔頭）。對調過的兩個名稱都會落在這裡，兩則錯誤合起來讀就是「它們互換了」。
  if (codeDataset.name !== docDataset.name) {
    failures.push({
      code,
      detail: [
        `名稱不一致：文件是 '${docDataset.name}'，${CODE_EXPORT_NAME} 是 '${codeDataset.name}'`,
        '      文件 §3.1 是唯一來源；若要改名，先改文件再改常數檔，兩邊逐字相同',
        `      ${docLocation(docDataset.lineNumber)}`,
        `      ${codeLocation(codeDataset.nameNode)}`,
      ].join('\n'),
    })
  }
}

for (const [code, codeDataset] of codeDatasets) {
  const reservedLineNumber = docReservedCodes.get(code)

  // 空號被填了東西。這是最壞的一種：它不會跟任何現有資料集衝突，看起來只是「多了一項」，
  // 但編號一旦被寫進資料庫就再也拿不回來（§3.1「編號不遞補」）。
  if (reservedLineNumber !== undefined) {
    failures.push({
      code,
      detail: [
        `文件把這個代碼標為${DOC_RESERVED_NAME}（永久空號），${CODE_EXPORT_NAME} 卻定義了 '${codeDataset.name}'`,
        '      空號不遞補、不重用：請改用一個沒被用過的新代碼，並先更新文件 §3.1',
        `      ${docLocation(reservedLineNumber)}`,
        `      ${codeLocation(codeDataset.node)}`,
      ].join('\n'),
    })
    continue
  }

  // 常數有、文件沒有 → 有人直接在程式碼裡加了資料集。唯一來源是文件，這個方向一律是錯的。
  if (!docDatasets.has(code)) {
    failures.push({
      code,
      detail: [
        `${CODE_EXPORT_NAME} 有這一項，文件 §3.1 沒有：'${codeDataset.name}'`,
        '      新增資料集要先寫進文件 §3.1 的表格（唯一來源），再改常數檔',
        `      ${codeLocation(codeDataset.node)}`,
      ].join('\n'),
    })
  }

  if (codeDataset.maintenance === undefined || !VALID_MAINTENANCE.includes(codeDataset.maintenance)) {
    const found =
      codeDataset.maintenance === undefined
        ? '算不出靜態的字串值（不是字面值也不是 as const 常數）'
        : `'${codeDataset.maintenance}'`
    failures.push({
      code,
      detail: [
        `maintenance${codeDataset.maintenance === undefined ? '' : '是'} ${found}，只能是 ${VALID_MAINTENANCE.join(' / ')}`,
        `      ${codeLocation(codeDataset.maintenanceNode)}`,
      ].join('\n'),
    })
  }
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * **一支掃不到東西的掃描器會永遠通過**，而「永遠通過」與「everything is fine」在 CI 上長得一模一樣。
 *
 * 兩個下限各盯一邊：文件那張表真的讀到列了嗎、常數檔真的讀到項目了嗎。少了任一項，
 * 表格改寫、章節改號、常數檔被清空這幾件事都會讓上面的迴圈跑 0 圈，而我們從此以為有人在看這份清單。
 *
 * 都是「至少一個」而不是確切數字：寫死數字的話每加一項資料集都要回來改這裡，
 * 而那種檢查最後一定會被人改成它當下看到的值。
 */
const selfCheckFailures: string[] = []
if (docDatasets.size === 0) {
  selfCheckFailures.push(`文件 §3.1 的表格一項資料集都沒讀到（${repoPath(DOC_FILE)}）：比對等於沒跑`)
}
if (codeDatasets.size === 0) {
  selfCheckFailures.push(`${CODE_EXPORT_NAME} 裡一項資料集都沒讀到（${repoPath(CODE_FILE)}）：比對等於沒跑`)
}

if (selfCheckFailures.length > 0) {
  process.stderr.write(
    [
      '資料集代碼掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
      ...selfCheckFailures.map((line) => `  ✗ ${line}`),
      // 自我檢查失敗時通常也會有一堆連帶的比對錯誤，一起印出來才看得出根因。
      ...failures.map(({ code, detail }) => `  ✗ [代碼 ${code}] ${detail}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (failures.length > 0) {
  process.stderr.write(
    [
      `法規資料集代碼與文件 §3.1 不一致（${failures.length} 筆）：`,
      // 依代碼排序：同一個代碼的問題會排在一起，讀起來就是「這一項怎麼了」。
      ...[...failures]
        .sort((left, right) => left.code - right.code)
        .map(({ code, detail }) => `  ✗ [代碼 ${code}] ${detail}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.stdout.write(
  `法規資料集代碼檢查通過：文件 ${docDatasets.size} 項 ＋ ${docReservedCodes.size} 個保留空號、` +
    `${CODE_EXPORT_NAME} ${codeDatasets.size} 項，代碼與名稱逐字一致。\n`,
)
