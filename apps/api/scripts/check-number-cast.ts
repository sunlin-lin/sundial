/**
 * 頁面與共用元件禁止數值轉型：`Number(` / `parseFloat(` / `parseInt(` / 一元 `+`
 *（計畫 03 §5.2 的 ✅ 掃描規則、前端規範 §9.2）。
 *
 * ## 為什麼需要一支腳本，而不是靠 review 或型別擋
 *
 * 後端的金額與費率一律是 decimal 字串，從資料庫到 API 全程不經過 `number`
 *（後端規範 §4.7 逐字寫著「勞健保級距在邊界值上會選錯級距」）。前端**一行**就能把它全部丟掉：
 *
 * ```ts
 * Number(record.data.monthlyContributionWage).toLocaleString()   // ✗
 * ```
 *
 * 這一行為什麼擋不住：
 *
 * - **型別完全合法**。`Number(string)` 回 `number`，`toLocaleString()` 回 `string`，
 *   整條運算式在 `vue-tsc` 眼裡沒有任何問題。
 * - **絕大多數值上都是對的**。九成的級距金額在 2^53 以內、九成的費率乘 100 剛好是個乾淨的數字，
 *   所以它在開發、在測試、在 demo 全部正常，**直到某一個級距的邊界值**。
 * - **出錯時沒有任何症狀**。不拋錯、不進 log、畫面照樣渲染，只是某一個人的保費差一塊錢，
 *   而發現的人是三個月後在核對薪資單的會計。
 * - **review 抓不到**。它跟正確的寫法只差一個函式名，而 diff 裡它看起來就是「把字串顯示出來」。
 *
 * ## 判準：怎麼機械判定「這是金額欄位」
 *
 * **判不出來，所以規則收成一個判得出來的形狀。** 計畫 §5.2 的原文是「禁止對**來自 API 的金額／
 * 費率欄位**使用 `Number(`」，但「這個運算式的值來不來自 API 的金額欄位」需要跨檔案的資料流分析
 * ——`Number(row.wage)` 裡的 `row` 從哪來、是不是 API 回來的、`wage` 是不是 decimal 欄位，
 * 三個問題都要追。做得出來的版本會很脆，而**脆的判準失效時是靜靜地不命中**（通用規範 §7.1、§7.6：
 * 全稱規則的定義域必須機械可算，不能是一個未定義的名詞）。
 *
 * 因此定義域收成純路徑判定：**{@link SCAN_ROOTS} 這兩個目錄底下一律禁止**，不問轉的是什麼。
 * 補集（§7.6 要求列出來）就是這兩個目錄以外的全部程式碼，其中真正需要數值轉型的有：
 * `shared/format/`（格式化本身，但它刻意也不用——見該目錄，全程字串運算）、`shared/api/`
 * （`expiresIn` 是後端給的 `number`，session 倒數要算它）、以及產生物 `api/generated/`。
 * 這三處都不在本規則的定義域內，**不需要例外清單**——沒有清單就沒有人會往清單裡加東西。
 *
 * **偽陽性的代價，誠實寫在這裡。** 這兩個目錄底下有些數值轉型跟金額一點關係都沒有：
 * 分頁頁碼、表格欄寬、`v-for` 的索引、從 query string 讀出來的 `page`。它們會被這支腳本擋下來，
 * 而正確的處置是**把那個轉型移出頁面**（分頁參數的解析屬於 §1.3 的 (4)，本來就該在
 * `.payload.ts` 之外的共用層；欄寬那種東西應該是常數而不是算出來的）。
 *
 * 這個代價是刻意換來的：反過來設計一條「只擋金額欄位」的規則，它會在**判斷不出來的時候放行**，
 * 而判斷不出來的情況恰好包含了最該擋的那些（`Number(row.data[key])` 這種動態取欄位）。
 * **寧可規則稍寬、被擋下來的人要繞一下，也不要一條靜靜地不命中任何東西的規則**——後者在 CI 上
 * 與「everything is fine」長得一模一樣，而且所有人都以為這件事已經被保障了（通用規範 §7.1）。
 *
 * ## 怎麼掃
 *
 * - **`.ts` 檔與 `.vue` 的 `<script>` 區塊走 AST**（`ts.createSourceFile`）。不是為了炫技：
 *   純文字掃描會命中**註解與字串**，而這條規則的相關註解（「這裡刻意不用 `Number(`」）一定會
 *   出現在頁面程式碼裡——一支會擋下自己的說明文字的掃描器，第一週就會被要求關掉。
 *   AST 也順便讓一元 `+` 判得準（`a + b` 與 `+a` 在文字上分不開，在 AST 上是兩種節點）。
 * - **`.vue` 的 `<template>` 區塊走純文字**（先剝掉 HTML 註解）：模板不是 TypeScript，
 *   沒有現成的剖析器可用。代價是模板裡的偽陽性判不掉，但 §1.4 已經禁止模板出現複雜運算式，
 *   模板裡本來就只該有 `{{ formatAmount(row.wage) }}` 這種單一函式呼叫。
 *
 * 執行：`bun run check:number-cast`（已串進 `bun run ci`）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：從哪個目錄呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** monorepo 根目錄。這支腳本掃的是 `apps/web`，位置一律以根目錄相對路徑印出才好跳。 */
const REPO_ROOT = resolve(API_ROOT, '../..')

/**
 * 規則的定義域（見檔頭）。**兩個都必須列，不能只掃 `pages/`**：
 * 共用元件是頁面把表格欄位交出去的地方，`Number(` 搬進 `shared/components/` 之後
 * 只掃 `pages/` 的版本會全綠，而搬過去的那個 PR 描述會是「抽出共用的金額欄位元件」。
 *
 * **`shared/components/` 目前還不存在**（第一個共用元件出現時才會有），因此「目錄不存在」
 * 不能是失敗——那會讓這支檢查在被真正需要之前就是紅的，而紅燈的處置一定是把它關掉。
 * 「兩個目錄都不存在」與「一個檔案都沒掃到」則是另一回事，由下面的自我檢查擋。
 */
const SCAN_ROOTS = ['apps/web/src/pages', 'apps/web/src/shared/components'] as const

/**
 * 要掃的副檔名。**`.vue` 不能漏**：`Number(` 最可能出現的地方就是頁面元件的 `<script setup>`
 * 與模板，而只掃 `.ts` 的版本在那兩處永遠是綠的。
 */
const SCANNED_EXTENSIONS = ['.ts', '.vue'] as const

/**
 * 被禁止的呼叫。比對的是**被呼叫的運算式原文**，因此 `Number.parseFloat(x)` 與
 * `globalThis.Number(x)` 這兩種繞法也命中。
 *
 * `Number.isInteger(x)` 這類**不做轉型**的靜態方法刻意不擋：它沒有把字串變成浮點數，
 * 擋它只會製造一個要被繞開的規則。
 */
const FORBIDDEN_CALL_PATTERN =
  /^(?:globalThis\.|window\.)?(?:Number|Number\.parseInt|Number\.parseFloat|parseInt|parseFloat)$/u

/** 模板（純文字）用的比對式。函式名後面必須緊跟 `(`，才不會命中「Number 這個字」。 */
const TEMPLATE_CALL_PATTERN = /\b(?:Number|parseInt|parseFloat)\s*\(/gu

/**
 * 模板裡的一元 `+`。
 *
 * lookbehind 排掉「前面是值」的情形（`a + b`、`f() + 1`、`'x' + y`、`++i`），
 * 剩下的就是前面沒有運算元的 `+`，也就是轉型。JS 的 lookbehind 可以變長，因此中間的空白一起吃掉。
 *
 * 這條只用在模板上（`.ts` 與 `<script>` 走 AST，判得準），偽陽性的代價見檔頭。
 */
const TEMPLATE_UNARY_PLUS_PATTERN = /(?<![\w$)\]"'.+]\s*)\+\s*[A-Za-z_$(]/gu

/** `<script>` 區塊。`[\s\S]*?` 非貪婪，多個區塊（`<script>` + `<script setup>`）各自抓到。 */
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gu

/** `<template>` 區塊。 */
const TEMPLATE_BLOCK_PATTERN = /<template\b[^>]*>([\s\S]*)<\/template>/u

/** HTML 註解。模板掃描前先剝掉，否則被註解掉的舊寫法會被當成違規。 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/gu

/** 一則違規。行號是**檔案內的絕對行號**（區塊偏移已經加回去），才能直接跳過去。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly detail: string
}

/**
 * 直接把整支腳本判為不可信並中止。寫成 function 宣告而不是箭頭函式，
 * 是為了讓 TypeScript 的控制流分析認得 `never`（同 `check-dataset-code.ts`）。
 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

/** 位置一律寫成 `根目錄相對路徑`，讓人可以直接跳過去改（§7.2）。 */
const repoPath = (absolutePath: string): string => relative(REPO_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 偵測（兩種輸入各一支，都是純函式——下面的自我檢查要拿它們去跑內建樣本）
// ---------------------------------------------------------------------------

/**
 * TypeScript 原始碼裡的數值轉型，走 AST。
 *
 * @param lineOffset 這段程式碼在原檔案裡的起始行（0-based）。`.vue` 的 `<script>` 區塊要靠它
 *   把行號加回去，否則報出來的位置永遠是「script 區塊內的第幾行」，而人打開檔案看到的是整個檔。
 */
const findCastsInScript = (code: string, file: string, lineOffset: number): Violation[] => {
  const sourceFile = ts.createSourceFile('scan.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []

  const record = (node: ts.Node, detail: string): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file,
      line: line + 1 + lineOffset,
      column: character + 1,
      source: node.getText(sourceFile).split('\n')[0]?.trim() ?? '',
      detail,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && FORBIDDEN_CALL_PATTERN.test(node.expression.getText(sourceFile))) {
      record(node, `${node.expression.getText(sourceFile)}(...) 會把 decimal 字串變成浮點數`)
    }

    // 一元 `+` 是同一件事的另一種寫法，而且更難在 review 中看見——它只有一個字元。
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) {
      record(node, '一元 + 是 Number() 的簡寫，失真的方式完全相同')
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

/** 模板（純文字）裡的數值轉型。行號由「這個位置之前有幾個換行」算出來。 */
const findCastsInTemplate = (template: string, file: string, lineOffset: number): Violation[] => {
  // 註解換成等長的空白，位置才不會位移——直接刪掉的話後面每一則違規的行號都會少算。
  const scanned = template.replace(HTML_COMMENT_PATTERN, (comment) => comment.replaceAll(/[^\n]/gu, ' '))
  const violations: Violation[] = []

  const record = (index: number, matched: string, detail: string): void => {
    const before = scanned.slice(0, index)
    const line = before.split('\n').length
    const lastBreak = before.lastIndexOf('\n')
    violations.push({
      file,
      line: line + lineOffset,
      column: index - lastBreak,
      source: matched.trim(),
      detail,
    })
  }

  for (const match of scanned.matchAll(TEMPLATE_CALL_PATTERN)) {
    record(match.index, match[0], `模板裡的 ${match[0].trim()}...) 會把 decimal 字串變成浮點數`)
  }
  for (const match of scanned.matchAll(TEMPLATE_UNARY_PLUS_PATTERN)) {
    record(match.index, match[0], '模板裡的一元 + 是 Number() 的簡寫，失真的方式完全相同')
  }

  return violations
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有要掃的檔案。目錄不存在時回空陣列（理由見 SCAN_ROOTS 的註解）。 */
const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return []

  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(path))
      continue
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path)
  }
  return found
}

/** 一段被抽出來的區塊：內容 ＋ 它在原檔的起始行（0-based）。 */
type SourceBlock = {
  readonly code: string
  readonly lineOffset: number
}

/** 某個位置在檔案裡的 0-based 行號。 */
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length - 1

const scanRoots = SCAN_ROOTS.map((root) => join(REPO_ROOT, root))
const existingRoots = scanRoots.filter((root) => existsSync(root))
const files = scanRoots.flatMap(listFiles)

const violations: Violation[] = []
let vueFileCount = 0
let scriptBlockCount = 0
let templateBlockCount = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const path = repoPath(file)

  if (!file.endsWith('.vue')) {
    violations.push(...findCastsInScript(source, path, 0))
    continue
  }

  vueFileCount += 1

  const scriptBlocks: SourceBlock[] = [...source.matchAll(SCRIPT_BLOCK_PATTERN)].map((match) => ({
    code: match[1] ?? '',
    // 區塊內容從 `<script ...>` 那一行的下一行開始，因此偏移要算到 `>` 之後那個位置。
    lineOffset: lineOf(source, match.index + match[0].indexOf('>') + 1),
  }))
  scriptBlockCount += scriptBlocks.length
  for (const block of scriptBlocks) violations.push(...findCastsInScript(block.code, path, block.lineOffset))

  const templateMatch = TEMPLATE_BLOCK_PATTERN.exec(source)
  if (templateMatch !== null) {
    templateBlockCount += 1
    const offset = lineOf(source, templateMatch.index + templateMatch[0].indexOf('>') + 1)
    violations.push(...findCastsInTemplate(templateMatch[1] ?? '', path, offset))
  }
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * **一支掃不到東西的掃描器會永遠通過**，而「永遠通過」與「everything is fine」在 CI 上
 * 長得一模一樣。這裡三個下限各盯一段不同的失效方式：
 *
 * 1. **目錄找得到嗎**：`pages/` 搬家、workspace 改名，`listFiles` 會安靜地回空陣列。
 * 2. **`.vue` 拆得開嗎**：`SCRIPT_BLOCK_PATTERN` 一旦寫壞，`.vue` 會全部變成「沒有程式碼的檔案」
 *    ——而 `.vue` 正是最可能出現 `Number(` 的地方（§1.1 要求每一支 `.vue` 都有 `<script setup>`，
 *    所以「有 `.vue` 卻一個 script 區塊都沒抽到」必定是比對式壞了，不是專案長那樣）。
 * 3. **判斷邏輯還認得出違規嗎**：拿一份**內建的樣本**去跑偵測函式，命中數不對就失敗。
 *    這一項與前兩項的差別在於它**不依賴 repo 現況**——即使有一天 `pages/` 底下乾淨到
 *    一則違規都沒有（正常狀態），它仍然證明得了「這支腳本真的擋得住東西」。
 *    這正是通用規範 §7.1 要求的那個紅燈證據，只是把它做成每次都跑一遍。
 */
const SELF_TEST_SCRIPT = [
  'const a = Number(row.wage)',
  'const b = parseFloat(row.rate)',
  'const c = Number.parseInt(row.count)',
  'const d = +row.wage',
  'const e = formatAmount(row.wage)', // 正確寫法，不得命中
  'const f = one + two', // 二元加法，不得命中
].join('\n')

const SELF_TEST_SCRIPT_EXPECTED = 4

const SELF_TEST_TEMPLATE = [
  '<span>{{ Number(row.wage) }}</span>',
  '<span>{{ +row.rate }}</span>',
  '<!-- {{ Number(row.old) }} 註解掉的不算 -->',
  '<span>{{ formatAmount(row.wage) }}</span>',
  '<span>{{ prefix + suffix }}</span>',
].join('\n')

const SELF_TEST_TEMPLATE_EXPECTED = 2

const selfCheckFailures: string[] = []

if (existingRoots.length === 0) {
  selfCheckFailures.push(`${SCAN_ROOTS.join('、')} 一個都不存在：目錄可能搬家了，這次掃描等於沒跑`)
}
if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個檔案（${SCAN_ROOTS.join('、')}）：這次掃描等於沒跑`)
}
if (vueFileCount > 0 && scriptBlockCount === 0) {
  selfCheckFailures.push(`掃到 ${String(vueFileCount)} 個 .vue 卻一個 <script> 區塊都沒抽到：區塊比對式壞了`)
}

const selfTestScriptHits = findCastsInScript(SELF_TEST_SCRIPT, '<self-test>', 0).length
if (selfTestScriptHits !== SELF_TEST_SCRIPT_EXPECTED) {
  selfCheckFailures.push(
    `內建樣本（程式碼）應命中 ${String(SELF_TEST_SCRIPT_EXPECTED)} 則，實際 ${String(selfTestScriptHits)} 則：AST 判斷已經失效`,
  )
}

const selfTestTemplateHits = findCastsInTemplate(SELF_TEST_TEMPLATE, '<self-test>', 0).length
if (selfTestTemplateHits !== SELF_TEST_TEMPLATE_EXPECTED) {
  selfCheckFailures.push(
    `內建樣本（模板）應命中 ${String(SELF_TEST_TEMPLATE_EXPECTED)} 則，實際 ${String(selfTestTemplateHits)} 則：模板比對式已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort([
    '數值轉型掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `頁面與共用元件不得對值做數值轉型（${String(violations.length)} 處，計畫 03 §5.2 / 前端規範 §9.2）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '金額與費率一律是 decimal 字串，顯示請走 apps/web/src/shared/format/：',
      '  formatAmount(value)  金額 → 千分位字串（字串切割，不經過 number）',
      '  formatRate(value)    比率 → 百分比字串（小數點位移，不經過 number）',
      '',
      '若被擋下來的轉型與金額無關（頁碼、索引、欄寬），那個轉型不該待在頁面裡——',
      '本規則刻意不分辨轉的是什麼，理由與代價寫在 apps/api/scripts/check-number-cast.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `數值轉型檢查通過：${String(files.length)} 個檔案（含 ${String(vueFileCount)} 個 .vue／` +
    `${String(scriptBlockCount)} 個 <script> 區塊、${String(templateBlockCount)} 個 <template> 區塊），` +
    `沒有 Number( / parseFloat( / parseInt( / 一元 +。\n`,
)
