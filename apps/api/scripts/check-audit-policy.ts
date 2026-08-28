/**
 * 稽核欄位政策完整性掃描：`AUDIT_FIELD_POLICY` ↔ 業務層輸入型別的欄位清單，雙向比對。
 *
 * **為什麼需要一支腳本，而不是用型別擋。** 政策是白名單（計畫 §4.3），而白名單的漏洞在型別上
 * 完全不可見：`AUDIT_FIELD_POLICY` 只是一個物件字面值，少寫一個 key 跟寫完是同一種東西，
 * `as const` 也只是把它釘成字面量型別，不會去問「這些 key 湊齊了嗎」。於是兩種改動編譯器一個字都看不到：
 *
 * - **型別加了一欄、政策沒跟上**：那一欄變成未分類。執行期 `recordAudit` 收到它會拋例外（§4.3），
 *   但那要等到有人真的改到那一欄才會爆，而爆的時間點是**線上**、症狀是一支本來會成功的更新開始 500。
 *   白名單的價值就在「漏了會紅」，漏在 CI 之外就等於沒有白名單。
 * - **型別把欄位改名或刪掉、政策沒跟上**：政策裡留下一個指不到任何東西的 key。它不會報錯，
 *   而新名字的那一欄同時變成未分類——**一次改動同時製造出一個幽靈與一個漏網**，兩者都沒有症狀。
 *
 * ## 比對的是「業務層型別」，不是 Drizzle schema
 *
 * 這一條是計畫 §4.3 寫死的，不是實作選擇：一個業務欄位可能對應多個實體欄位
 * （`identityNumber` 在 schema 裡是 `identityNumberEncrypted` ＋ `identityNumberHash`，
 * 沒有任何一欄叫 `identityNumber`）。照 schema 比對的話這一欄永遠對不上，而**修法只有兩條**——
 * 一條是把腳本改成鬆散比對（剝後綴、正規化大小寫），從此它驗證的是一份人工拼湊的映射，
 * 跟 `recordAudit` 執行時真正收到的欄位集合對不上，**而且是綠的**。所以來源由政策自己的
 * `source` 明寫（§4.5），腳本不去猜。
 *
 * ## 兩邊各用什麼讀
 *
 * - **型別那一邊用 TypeScript 的 type checker**：`EmployeeProfileInput` 這種型別可以是交集
 *   （`{ id } & EmployeeProfileInput`）、可以 `Pick`／`Omit`、可以 re-export。文字剖析在這些形狀上
 *   會少讀欄位，而「少讀」的表現是**比對通過**——掃描器最糟的失效方向。checker 算出來的欄位集合
 *   就是編譯器認定的那一份，沒有第二種解讀。
 * - **政策那一邊讀 AST**，不 import 它的值：政策檔由另一個模組提供，可能還不存在或還在改，
 *   靜態 import 會讓整個 `bun run typecheck` 跟著紅，而那是不相干的紅燈。讀 AST 也順便拿得到
 *   行號（通用規範 §7.2 要求掃描器輸出命中位置）。
 *
 * **代價寫在這裡：政策的「結構」必須是字面值寫死的。** 展開（`...BASE`）、計算屬性名（`[KEY]:`）、
 * 從別處 import 進來再組起來的片段，這支腳本都讀不到有哪些表、哪些欄位。因此它遇到看不懂的節點
 * **一律失敗，不略過**——略過的話那張表會靜靜地不被檢查，而輸出仍然是「檢查通過」。
 * 至於 `source` 與級別這兩個**值**，則是問 checker 而不是讀字面（見 `literalStringValue`），
 * 於是 `AuditFieldLevel.Value` 這種具名常數照樣讀得到。
 *
 * 執行：`bun run check:audit-policy`（已串進 `bun run ci`）。
 */
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：腳本從哪個目錄被呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** `source` 字串裡的相對路徑以此為起點（`modules/employees/...` → `apps/api/src/modules/employees/...`）。 */
const SRC_ROOT = join(API_ROOT, 'src')

/** 政策檔的位置與匯出名，由計畫 §4.5 定死。搬家或改名時這支腳本會失敗而不是靜靜掃不到東西。 */
const POLICY_FILE = join(SRC_ROOT, 'modules/audit/main/domain/audit-field-policy.ts')
const POLICY_EXPORT_NAME = 'AUDIT_FIELD_POLICY'

/** 三級白名單（§4.3）。三級而不是兩級，是為了讓「刻意不記」與「忘了分類」分得開。 */
const VALID_LEVELS: readonly string[] = ['value', 'presence', 'excluded']

/** `apps/api/tsconfig.json`：和 `bun run typecheck` 讀同一份設定，掃到的檔案集合才會跟編譯器一致。 */
const TSCONFIG_FILE = join(API_ROOT, 'tsconfig.json')

/** 一則不一致。`table` 讓錯誤訊息指得出是哪一張表的政策壞了，而不只是「某處對不上」。 */
type Failure = {
  readonly table: string
  readonly field: string
  readonly detail: string
}

const failures: Failure[] = []

/**
 * 直接把整支腳本判為不可信並中止：政策檔不存在、tsconfig 讀不到這類「掃描前提不成立」的情形。
 *
 * 寫成 function 宣告而不是 const 箭頭函式，是為了讓 TypeScript 的控制流分析認得 `never`
 * ——箭頭函式要另外標注變數型別才有同樣效果，那是更容易在重構時掉的一種寫法。
 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 錯誤訊息裡的位置一律寫成 `專案相對路徑:行號`，讓人可以直接跳過去改（§7.2）。 */
const locate = (node: ts.Node): string => {
  const file = node.getSourceFile()
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
  return `${relative(API_ROOT, file.fileName).replaceAll('\\', '/')}:${line + 1}`
}

// ---------------------------------------------------------------------------
// 掃描前提：政策檔必須存在
// ---------------------------------------------------------------------------

// 另一個模組還沒把檔案交出來時，這裡是唯一一個「腳本沒辦法做事」的合法出口。
// 刻意不做成「檔案不在就跳過」：那會讓政策檔被誰刪掉之後 CI 依然全綠。
if (!existsSync(POLICY_FILE)) {
  abort([
    '找不到稽核欄位政策檔，這次掃描等於沒跑：',
    `  ✗ ${relative(API_ROOT, POLICY_FILE).replaceAll('\\', '/')}`,
    '    這個檔案由 modules/audit 提供（形狀見 docs/plans/02-audit-logs.md §4.5）。',
    '    若它已經搬家或改名，請一併修正本腳本的 POLICY_FILE，不要把這個檢查停掉。',
  ])
}

// ---------------------------------------------------------------------------
// 建立 program
// ---------------------------------------------------------------------------

const configHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    abort(['讀不到 apps/api/tsconfig.json，型別欄位無從取得：', `  ✗ ${message}`])
  },
}

const parsedConfig = ts.getParsedCommandLineOfConfigFile(TSCONFIG_FILE, {}, configHost)

if (parsedConfig === undefined) abort(['讀不到 apps/api/tsconfig.json，型別欄位無從取得。'])

// 用 tsconfig 算出來的完整檔案集合建 program，而不是只丟政策檔與型別檔進去：
// 少了 include 範圍，型別檔 import 的東西會解析不到，checker 會安靜地回一個空的欄位集合。
const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options: parsedConfig.options })
const checker = program.getTypeChecker()

const policySourceFile = program.getSourceFile(POLICY_FILE)
if (policySourceFile === undefined) {
  abort([
    '政策檔存在，但不在 apps/api/tsconfig.json 的 include 範圍內：',
    `  ✗ ${relative(API_ROOT, POLICY_FILE).replaceAll('\\', '/')}`,
    '    不在範圍內代表它也沒有被 `bun run typecheck` 檢查過。請修正 tsconfig 的 include。',
  ])
}

// ---------------------------------------------------------------------------
// 讀政策（AST）
// ---------------------------------------------------------------------------

/** 政策裡的一張表。保留 node 是為了讓每一則錯誤都指得出行號。 */
type PolicyTable = {
  readonly table: string
  readonly source: string
  readonly sourceNode: ts.Node
  /** `fields` 那一塊的位置。未分類的欄位要補在這裡，錯誤訊息得指得出來。 */
  readonly fieldsNode: ts.Node
  /** 業務欄位名 → 級別字串（算不出靜態值時為 `undefined`）與它所在的節點。 */
  readonly fields: ReadonlyMap<string, { readonly level: string | undefined; readonly node: ts.Node }>
}

/**
 * 剝掉 `as const`／`satisfies`／多餘括號，拿到真正的物件字面值。
 *
 * §4.5 的形狀是 `{ ... } as const`，但政策日後也可能改寫成 `satisfies AuditFieldPolicy`。
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
 * **不只認字串字面值，也問 checker**：政策實際上把級別寫成 `AuditFieldLevel.Value` 這種具名常數
 * （比裸字串好，因為打錯字當場是編譯錯誤），而那在 AST 上是一個屬性存取，看不出值。
 * checker 對 `as const` 的常數會算出字面量型別，於是兩種寫法都讀得到——**不必逼政策改寫成裸字串**。
 * 這一步只用來讀值，結構（哪些 key、幾張表）仍然一律走 AST，理由見檔頭。
 */
const literalStringValue = (node: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(node)) return node.text
  const type = checker.getTypeAtLocation(node)
  return type.isStringLiteral() ? type.value : undefined
}

/** 屬性名只收識別字與字串字面值。計算屬性名（`[KEY]:`）讀不出靜態值，落到這裡回 `undefined` 由呼叫端報錯。 */
const staticPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

/**
 * 走訪物件字面值的屬性，**遇到任何非「純字面值屬性」的寫法就中止整支腳本**。
 *
 * 這裡刻意不是「跳過看不懂的節點」：跳過的後果是那一張表（或那一批欄位）不再被比對，
 * 而輸出仍然是綠的「檢查通過」——掃描器最危險的失效模式。寧可要一次很吵的失敗。
 */
const literalProperties = (object: ts.ObjectLiteralExpression, context: string): ts.PropertyAssignment[] => {
  const properties: ts.PropertyAssignment[] = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || staticPropertyName(property.name) === undefined) {
      abort([
        `政策裡有這支腳本讀不懂的寫法，掃描結果不可信（${context}）：`,
        `  ✗ ${locate(property)}`,
        '    只支援直接寫死的屬性（`key: 值`）。展開（...）、計算屬性名（[KEY]:）、簡寫、方法都讀不到，',
        '    而讀不到的部分不會被比對，卻仍然會印出「檢查通過」。請把政策攤平成字面值。',
      ])
    }
    properties.push(property)
  }
  return properties
}

const policyDeclaration = policySourceFile.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => statement.declarationList.declarations)
  .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === POLICY_EXPORT_NAME)

if (policyDeclaration?.initializer === undefined) {
  abort([
    `政策檔裡找不到 ${POLICY_EXPORT_NAME}：`,
    `  ✗ ${relative(API_ROOT, POLICY_FILE).replaceAll('\\', '/')}`,
    `    預期是 \`export const ${POLICY_EXPORT_NAME} = { ... } as const\`（見 docs/plans/02-audit-logs.md §4.5）。`,
  ])
}

const policyObject = unwrapExpression(policyDeclaration.initializer)
if (!ts.isObjectLiteralExpression(policyObject)) {
  abort([
    `${POLICY_EXPORT_NAME} 不是直接寫死的物件字面值：`,
    `  ✗ ${locate(policyObject)}`,
    '    這支腳本靠 AST 讀政策（理由見檔頭），組合出來的值讀不到，會變成「掃不到東西卻通過」。',
  ])
}

const policyTables: PolicyTable[] = []

for (const tableProperty of literalProperties(policyObject, POLICY_EXPORT_NAME)) {
  const table = staticPropertyName(tableProperty.name) ?? ''
  const tableValue = unwrapExpression(tableProperty.initializer)

  if (!ts.isObjectLiteralExpression(tableValue)) {
    abort([
      `政策的 ${table} 不是物件字面值：`,
      `  ✗ ${locate(tableValue)}`,
      "    預期形狀：{ source: '<相對路徑>#<型別名>', fields: { ... } }。",
    ])
  }

  const entries = new Map(
    literalProperties(tableValue, `${POLICY_EXPORT_NAME}.${table}`).map((property) => [
      staticPropertyName(property.name) ?? '',
      property,
    ]),
  )

  const sourceProperty = entries.get('source')
  const fieldsProperty = entries.get('fields')

  if (sourceProperty === undefined || fieldsProperty === undefined) {
    abort([
      `政策的 ${table} 少了必要的 key：`,
      `  ✗ ${locate(tableValue)}`,
      `    source: ${sourceProperty === undefined ? '缺少' : '有'}、fields: ${fieldsProperty === undefined ? '缺少' : '有'}。`,
      '    兩者都是必要的：source 決定要拿哪個型別來比對，fields 是被比對的那一份分類。',
    ])
  }

  const sourceNode = unwrapExpression(sourceProperty.initializer)
  const source = literalStringValue(sourceNode)
  if (source === undefined) {
    abort([
      `政策的 ${table}.source 算不出靜態的字串值：`,
      `  ✗ ${locate(sourceNode)}`,
      "    預期形如 'modules/employees/main/domain/employee-model.ts#EmployeeProfileInput'。",
      '    來源要在不執行程式的情況下就看得出來，否則掃描器沒有辦法知道該比對哪一個型別。',
    ])
  }

  const fieldsValue = unwrapExpression(fieldsProperty.initializer)
  if (!ts.isObjectLiteralExpression(fieldsValue)) {
    abort([`政策的 ${table}.fields 不是物件字面值：`, `  ✗ ${locate(fieldsValue)}`])
  }

  const fields = new Map<string, { readonly level: string | undefined; readonly node: ts.Node }>()
  for (const fieldProperty of literalProperties(fieldsValue, `${POLICY_EXPORT_NAME}.${table}.fields`)) {
    const field = staticPropertyName(fieldProperty.name) ?? ''
    // 級別算不出靜態值時記成 `undefined`，交給下面的級別檢查報錯，不在這裡中止：
    // 級別壞掉不影響「欄位有沒有分類」的比對，一次把兩種問題都印出來，人才能一輪修完。
    fields.set(field, { level: literalStringValue(unwrapExpression(fieldProperty.initializer)), node: fieldProperty })
  }

  policyTables.push({ table, source, sourceNode, fieldsNode: fieldsValue, fields })
}

// ---------------------------------------------------------------------------
// 讀型別（type checker）並雙向比對
// ---------------------------------------------------------------------------

/**
 * 依 `source` 取出型別的欄位名集合。取不到時回 `undefined`，並已經把原因記進 `failures`。
 *
 * 回 `undefined` 而不是空集合是刻意的：空集合會讓下面的比對變成「型別一欄都沒有」，
 * 於是政策裡每一欄都被報成幽靈欄位——一堆假錯誤會蓋掉真正的原因（source 指錯了）。
 */
const fieldsOfSource = (table: PolicyTable): ReadonlySet<string> | undefined => {
  const fail = (detail: string): undefined => {
    failures.push({ table: table.table, field: 'source', detail: `${detail}\n      ${locate(table.sourceNode)}` })
    return undefined
  }

  // 恰好一個 `#`，兩邊都不得為空。多一個或少一個都當成寫錯而不是猜意圖：
  // 猜錯的話會去比對一個不相干的型別，而那份比對結果看起來一樣合理。
  const segments = table.source.split('#')
  const [relativePath, typeName] = segments
  if (segments.length !== 2 || relativePath === undefined || relativePath === '' || typeName === undefined || typeName === '') {
    return fail(`source 格式錯誤：'${table.source}'，預期 '<相對於 apps/api/src 的路徑>#<型別名>'`)
  }

  const typeFile = join(SRC_ROOT, relativePath)
  const typeSourceFile = program.getSourceFile(typeFile)
  if (typeSourceFile === undefined) {
    return fail(`source 指向的檔案不存在或不在 tsconfig 的 include 內：src/${relativePath}`)
  }

  const moduleSymbol = checker.getSymbolAtLocation(typeSourceFile)
  if (moduleSymbol === undefined) return fail(`src/${relativePath} 沒有任何 export，取不到型別`)

  const exported = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.getName() === typeName)
  if (exported === undefined) return fail(`src/${relativePath} 沒有匯出型別 ${typeName}（改名或刪掉了？）`)

  // `export type { X } from '...'` 這種 re-export 拿到的是 alias symbol，直接問它的宣告型別會拿到 error type。
  const symbol = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported

  const declarations = symbol.declarations ?? []
  const typeDeclaration = declarations.find((node) => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
  if (typeDeclaration === undefined) return fail(`src/${relativePath} 的 ${typeName} 不是型別別名或介面`)

  // 泛型沒有帶入型別參數就取不到確定的欄位集合，checker 會回一堆型別參數當屬性——
  // 那份清單跟執行期真正的欄位無關，比對出來的結果不可信。
  if (typeDeclaration.typeParameters !== undefined) {
    return fail(`${typeName} 是泛型，無法取得確定的欄位清單。請讓 source 指向一個已具體化的型別`)
  }

  const declaredType = checker.getDeclaredTypeOfSymbol(symbol)
  const names = new Set(checker.getPropertiesOfType(declaredType).map((property) => property.getName()))
  if (names.size === 0) {
    // 聯集型別只取得到共同欄位，常常是 0 個；這種 source 一定是指錯了，不能當成「這張表沒有欄位」放過。
    return fail(`${typeName} 取不到任何欄位（它是聯集或不是物件型別？）`)
  }
  return names
}

let resolvedTypeCount = 0
let policyFieldCount = 0
let typeFieldCount = 0

for (const table of policyTables) {
  policyFieldCount += table.fields.size

  // 級別檢查先做：它不依賴型別讀不讀得到，source 壞掉時仍然應該一起把級別的問題報出來，
  // 讓人一輪就修完，而不是修完 source 再跑一次才看到下一批錯。
  for (const [field, { level, node }] of table.fields) {
    if (level !== undefined && VALID_LEVELS.includes(level)) continue
    const found = level === undefined ? '算不出靜態的字串值（不是字面值也不是 as const 常數）' : `'${level}'`
    failures.push({
      table: table.table,
      field,
      detail: `級別${level === undefined ? '' : '是'} ${found}，只能是 ${VALID_LEVELS.join(' / ')}\n      ${locate(node)}`,
    })
  }

  const typeFields = fieldsOfSource(table)
  if (typeFields === undefined) continue

  resolvedTypeCount += 1
  typeFieldCount += typeFields.size

  // 型別有、政策沒有 → 那一欄未分類。白名單漏一欄不會有任何症狀，這裡是唯一擋得住的地方（§4.3）。
  for (const field of typeFields) {
    if (table.fields.has(field)) continue
    failures.push({
      table: table.table,
      field,
      detail: [
        `型別 ${table.source} 有這一欄，政策沒有分類它`,
        `      請在 ${table.table}.fields 補上 ${field}，級別擇一：${VALID_LEVELS.join(' / ')}`,
        `      ${locate(table.fieldsNode)}`,
      ].join('\n'),
    })
  }

  // 政策有、型別沒有 → 欄位改名或刪除時政策沒跟著改。改名的話新名字同時會落在上面那一輪，
  // 兩則錯誤合起來讀就是「這一欄從 A 改成 B 了」。
  for (const [field, { node }] of table.fields) {
    if (typeFields.has(field)) continue
    failures.push({
      table: table.table,
      field,
      detail: [
        `政策宣告了這一欄，但型別 ${table.source} 沒有它`,
        '      欄位改名的話請一起改政策；欄位已刪除的話請刪掉這一行',
        `      ${locate(node)}`,
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
 * 四個下限各盯一段管線：政策讀到了嗎、`source` 至少有一個指得到真的型別嗎、政策裡真的有欄位嗎、
 * 型別那一邊真的取到欄位嗎。少了最後一項，一個回空集合的 checker 會讓「政策全部是幽靈欄位」
 * 看起來像是政策的錯，而不是掃描器壞了。
 *
 * 全部是「至少一個」而不是確切數字：寫死數字的話每加一張表都要回來改這裡，
 * 而那種檢查最後一定會被人改成它當下看到的值。
 */
const selfCheckFailures: string[] = []
if (policyTables.length === 0) selfCheckFailures.push(`${POLICY_EXPORT_NAME} 裡一張表都沒有：政策是空的，比對等於沒跑`)
if (policyFieldCount === 0) selfCheckFailures.push('政策裡一個欄位都沒有：fields 全空，比對等於沒跑')
if (resolvedTypeCount === 0) selfCheckFailures.push('沒有任何一個 source 指得到型別：型別那一邊完全沒讀到')
if (typeFieldCount === 0) selfCheckFailures.push('型別那一邊一個欄位都沒取到：type checker 沒有正常運作')

if (selfCheckFailures.length > 0) {
  process.stderr.write(
    [
      '稽核政策掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
      ...selfCheckFailures.map((line) => `  ✗ ${line}`),
      // 自我檢查失敗時通常也會有一堆連帶的比對錯誤，一起印出來才看得出根因。
      ...failures.map(({ table, field, detail }) => `  ✗ [${table}] ${field}\n      ${detail}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (failures.length > 0) {
  process.stderr.write(
    [
      `稽核欄位政策與業務型別不一致（${failures.length} 筆）：`,
      ...failures.map(({ table, field, detail }) => `  ✗ [${table}] ${field}\n      ${detail}`),
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.stdout.write(
  `稽核欄位政策檢查通過：${policyTables.length} 張表、${resolvedTypeCount} 個型別來源、${policyFieldCount} 個欄位，雙向一致。\n`,
)
