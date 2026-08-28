/**
 * 帶時區偏移的時間資訊不得外洩到畫面：前端規範 §9.2（與 §3.7 互為犄角）的兩支掃描，
 * 合併成一支腳本、三條規則、同一組檔案、同一次 AST 走訪。
 *
 * ## 為什麼是三條規則，而不是「兩支腳本各自對一半」
 *
 * §9.2 指派的兩支掃描是：
 *
 * 1. **顯示路徑不得引用 `exp`**——envelope 的絕對截止時刻，§3.7 明文它唯一用途是寫進
 *    log 與錯誤回報，一旦顯示，使用者的裝置時區與時鐘偏移會讓兩個人在同一秒看到不同的到期時刻，
 *    而且兩個都「看起來合理」（檔頭這句話直接抄自 §3.7 的理由段，不是意譯）。
 * 2. **頁面不得處理帶時區標記的時間字串**——`+08:00` / `-08:00` / 結尾 `Z` / `T` 分隔符，
 *    這是業務時間格式（`YYYY-MM-DD HH:mm:ss`，空白分隔、無時區標記）永遠不會長成的形狀，
 *    出現就代表 `rqTS`／`rspTS`／`exp` 有一個漏出了傳輸層。
 *
 * 這兩條在**判準的形狀**上是同一件事：都是「在不該出現時區標記的地方，出現了時區標記」，
 * 差別只在標記的樣子是識別字（`exp`）還是字面值裡的子字串（`+08:00` 之類）。第三條規則——
 * **`shared/format/` 以外禁止 `new Date(` / `Date.now(`**——雖然文字上是 §9.2 的既有條文，
 * 但它是前兩條的**根因防線**：業務時間字串一旦被丟進 `Date`，就會被瀏覽器依裝置時區重新解讀
 * 一次，而重新解讀出來的物件再輸出時，很可能就是下一個「帶時區標記的字串」的來源
 * （`toISOString()` 這類輸出天生帶 `Z`）。三條規則盯的是同一個故事的三個時間點：
 * **源頭**（不准把字串轉成 `Date`）、**攜帶**（字面值不准長成帶偏移的樣子）、
 * **終點**（`exp` 這個特定攜帶者不准被引用）。分成三支各自維護，會需要三份「哪些檔案要掃」
 * 的清單、三份自我檢查；合成一支，檔案清單只需要決定一次，AST 只需要走一次。
 *
 * ## 判準：怎麼機械判定，以及誠實的偽陽性代價
 *
 * 三條規則各自的定義域與判準都收成「路徑 + 語法形狀」，不做任何跨檔案資料流分析
 * （理由與 `check-number-cast.ts` 相同：資料流分析做得出來的版本很脆，脆的判準失效時
 * 是靜靜地不命中，通用規範 §7.1／§7.6）。
 *
 * | 規則 | 定義域 | 判準 |
 * |---|---|---|
 * | `exp` 引用 | 全站 `.vue`（`<script>` 與 `<template>` 皆算，§3.7 原文「任何顯示路徑」）；`pages/`／`shared/components/`／`shared/format/` 底下的 `.ts`（見下） | 識別字 `exp`（獨立詞，不含 `expiresIn`／`expForLog`） |
 * | 帶時區標記的字面值 | `pages/`／`shared/components/` 底下的 `.ts` 與 `.vue` | 字串／樣板字面值命中 `+08:00`／`-08:00`／`\d`+`T`+`\d\d:\d\d`／`\d\d:\d\d:\d\dZ` |
 * | 遊蕩的 `new Date(` / `Date.now(` | 全站，扣掉 `shared/format/`、兩個白名單檔案、`*.test.ts` | `new Date(...)`（任何引數個數）或 `Date.now(...)` |
 *
 * **`exp` 規則為什麼把定義域從「只有 `.vue`」擴大到 `pages/`／`shared/components/` 的 `.ts`。**
 * §3.7 的原文字面只提到「`.vue` 模板與 `<script setup>` 一律不得出現 `exp`」與「format 模組不得有
 * 以 `exp` 為輸入或輸出的函式」，沒有提到 `.view.ts`／`.actions.ts`／`.payload.ts`。但 §1.3 把
 * 「表格列怎麼組」「狀態顯示什麼文字」這兩類呈現決策**指定**放進 `.view.ts`——它的輸出直接餵給
 * `.vue` 的模板，中間沒有第二層轉換。若這條規則只鎖 `.vue`，`exp` 完全可以先被塞進同頁的
 * `.view.ts` 算出一個字串、模板再把那個字串印出來，`.vue` 檔案本身一個 `exp` 字都不會出現，
 * 掃描全綠——這正是 `check-number-cast.ts` 檔頭警告過的同一種繞法（把邏輯搬進頁面目錄下的
 * 另一個檔案，讓只鎖单一副檔名或單一角色檔的規則失去命中）。`shared/components/` 併入的理由
 * 與 `check-number-cast.ts` 完全相同：頁面把邏輯搬進共用元件，一樣不該讓規則跟著失效。
 *
 * **`exp` 規則的偽陽性代價，誠實寫在這裡：`Math.exp(x)`（自然指數函式）會撞到同一個識別字。**
 * 本規則專門排除了 `Math.exp` 這一種寫法（見 {@link isMathExpMember}）——選它是因為它是
 * JS 內建、寫法固定、不會被誤認的唯一常見來源；除此之外**不再開白名單**，任何其他叫做 `exp`
 * 的識別字（無論是不是巧合）在這三個定義域內一律算違規。這比「只擋真正的 envelope.exp」寬，
 * 但符合 `check-number-cast.ts` 檔頭的原則：寧可稍寬、讓被誤傷的人繞一下（把變數改名），
 * 也不要一條因為想精準而在關鍵時刻不命中的規則。
 *
 * **帶時區標記字面值規則只認「字面值」，不做資料流追蹤。** `formatDateTime(row.rqTS)` 這種
 * 「把傳輸層時戳硬塞給格式化函式」的寫法，字面上看不到任何時區標記字串——`row.rqTS` 只是一個
 * 識別字，值是執行期才有的東西，這支腳本讀不到。這是刻意收窄後的判準：能可靠判斷的只有「原始碼
 * 裡有沒有寫死一段長得像帶偏移時戳的字串」，抓不到「變數的執行期值長得像」。發生機率也低——
 * `rqTS`／`rspTS`／`exp` 三個名字本身已經被 `exp` 規則與 `shared/api/` 的封裝擋住大半條路，
 * 這條規則補的是「有人把這種格式的字串直接寫死在頁面程式碼裡」（測試假資料、複製貼上的除錯字串、
 * 手滑把後端 log 範例貼進頁面），而不是「抓到每一種資料流向」。
 *
 * **`new Date(` 規則刻意不像後端 §6.2 那樣只抓零引數的 `new Date()`。** 後端的規則是「禁止直接讀
 * 系統時間」，`new Date('2026-...')` 建構一個已知時刻沒有那個問題，所以放行。前端 §9.2 的問題
 * 不是「讀到系統時間」，而是「業務時間字串一旦經過 `Date`，輸出就會被裝置時區重新解讀」——
 * 這件事**不管有沒有引數都會發生**（`new Date('2026-08-26 09:30:00')` 一樣會被當成瀏覽器時區）。
 * 因此這裡的判準是「只要出現 `new Date(`，不管括號裡寫什麼」，字面上完全對齊 §9.2「format 模組
 * 以外禁止 `new Date(`」這句話（連同後面的括號都寫進條文了）。
 *
 * ## 怎麼掃
 *
 * 與 `check-number-cast.ts` 同一套分工：**`.ts` 與 `.vue` 的 `<script>` 走 AST**
 * （`ts.createSourceFile`，第四個參數開 `setParentNodes`，`Math.exp` 的排除要靠讀 `node.parent`
 * 判斷是不是 `PropertyAccessExpression` 的成員），**`.vue` 的 `<template>` 走純文字**
 * （先剝掉 HTML 註解，模板沒有現成剖析器，且 §1.4 已經禁止模板出現複雜運算式，模板裡的
 * 偽陽性代價本來就比 script 低）。
 *
 * 執行：`bun run check:tz-leak`（已串進 `bun run ci`）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** `apps/api`。以本檔位置推導而不是 `process.cwd()`：從哪個目錄呼叫都要指向同一份專案。 */
const API_ROOT = resolve(fileURLToPath(import.meta.url), '../..')

/** monorepo 根目錄。這支腳本掃的是 `apps/web`，位置一律以根目錄相對路徑印出才好跳。 */
const REPO_ROOT = resolve(API_ROOT, '../..')

/** 這支腳本唯一的掃描根：整個前端原始碼樹（三條規則的定義域都是它的子集，見檔頭表格）。 */
const WEB_SRC_ROOT = join(REPO_ROOT, 'apps/web/src')

const SCANNED_EXTENSIONS = ['.ts', '.vue'] as const

/**
 * 產生物目錄：`bun run gen:api` 的輸出，不是手寫程式碼，也不進版控（後端規範 §1.7）。
 * 掃它只會在 clone 下來還沒跑產生器時報「目錄不存在」的假警報，或是在跑過之後掃到
 * 沒有人能修改的產生碼——兩種結果都對這支腳本要抓的問題沒有幫助。
 */
const EXCLUDED_PREFIX = 'api/generated/'

/** 三條規則各自的定義域前綴（相對於 `WEB_SRC_ROOT`，一律正斜線）。理由見檔頭表格。 */
const PAGES_PREFIX = 'pages/'
const SHARED_COMPONENTS_PREFIX = 'shared/components/'
const SHARED_FORMAT_PREFIX = 'shared/format/'

/**
 * `new Date(` / `Date.now(` 規則的白名單，**只有這兩個檔案**（§9.2 原文「例外只有兩處且須列在
 * 白名單」）：`request-timestamp.ts` 產生 `rqTS`（本來就需要建構一個時刻再格式化成台北時間），
 * `session-deadline.ts` 用 `Date.now()` 算 `deadline`（§3.7：`deadline` 與「現在」要用同一個時鐘，
 * 這是唯一正確的寫法）。清單只有兩項就是全部——不是「先列這兩個，之後陸續補」。
 */
const NEW_DATE_EXEMPT_FILES = new Set<string>(['shared/api/request-timestamp.ts', 'shared/api/session-deadline.ts'])

/** 相對於 `WEB_SRC_ROOT` 的正斜線路徑。Windows 上 `relative()` 回傳反斜線，這裡統一正規化。 */
const relFromWebSrc = (absolutePath: string): string => relative(WEB_SRC_ROOT, absolutePath).replaceAll('\\', '/')

/** 位置一律寫成「根目錄相對路徑」，讓人可以直接跳過去改（通用規範 §7.2）。 */
const repoPath = (absolutePath: string): string => relative(REPO_ROOT, absolutePath).replaceAll('\\', '/')

/**
 * 這個相對路徑（含檔案自身）落在哪些規則的定義域內。
 *
 * `exp` 規則對 `.vue` 沒有路徑限制（§3.7 原文「任何顯示路徑」），對 `.ts` 收在
 * `pages/`／`shared/components/`／`shared/format/`（理由見檔頭）。
 */
type Domain = {
  readonly exp: boolean
  readonly tzString: boolean
  readonly newDate: boolean
}

const domainOf = (rel: string, isVue: boolean): Domain => {
  const underPages = rel.startsWith(PAGES_PREFIX)
  const underSharedComponents = rel.startsWith(SHARED_COMPONENTS_PREFIX)
  const underSharedFormat = rel.startsWith(SHARED_FORMAT_PREFIX)

  return {
    exp: isVue || underPages || underSharedComponents || underSharedFormat,
    tzString: underPages || underSharedComponents,
    newDate: !underSharedFormat && !NEW_DATE_EXEMPT_FILES.has(rel) && !rel.endsWith('.test.ts'),
  }
}

/** 三條規則各自的識別名，只用於錯誤訊息分類與自我檢查計數。 */
type Rule = 'exp-leak' | 'tz-string' | 'stray-new-date'

/** 一則違規。行號是**檔案內的絕對行號**（區塊偏移已經加回去），才能直接跳過去。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly rule: Rule
  readonly source: string
  readonly detail: string
}

/** 直接把整支腳本判為不可信並中止（寫成 function 宣告讓 TS 控制流分析認得 `never`）。 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 判準的正規表示式
// ---------------------------------------------------------------------------

/**
 * `new Date` / `Date.now` 的被呼叫物件原文比對式。比對的是**運算式原文**，因此
 * `new globalThis.Date()`／`new window.Date()`／`globalThis.Date.now()` 這類繞法也命中
 * （與 `check-number-cast.ts` 的 `FORBIDDEN_CALL_PATTERN` 同一套作法）。
 */
const DATE_CALLEE_PATTERN = /^(?:globalThis\.|window\.)?Date$/u

/**
 * 帶時區標記的時間字面值的特徵（檔頭表格）。四個分支對應任務指定的四種標記：
 *
 * - `\+08:00` / `-08:00`：最常見的台北偏移量寫法（後端規範 §6.1、§1.3）。
 * - `\dT\d{2}:\d{2}`：ISO 8601 的 `T` 分隔符，要求前面緊跟一個數字（日期的個位數）、
 *   後面緊跟兩位數:兩位數（時:分），排除單獨一個大寫字母 `T`（品名、代號常見）造成的誤判。
 * - `\d{2}:\d{2}:\d{2}Z\b`：UTC 的 `Z` 結尾，要求前面是完整的「時:分:秒」，排除任何跟時間
 *   無關、恰好以大寫 `Z` 結尾的字串。
 *
 * 業務時間字串（`YYYY-MM-DD HH:mm:ss`，後端規範 §6.1）用空白分隔、不帶 `T`，也沒有結尾標記，
 * 四個分支都不會命中——這正是這條規則要保護的正常路徑。
 */
const TIMEZONE_MARK_PATTERN = /\+08:00|-08:00|\dT\d{2}:\d{2}|\d{2}:\d{2}:\d{2}Z\b/u

/** `<script>` 區塊。`[\s\S]*?` 非貪婪，多個區塊（`<script>` + `<script setup>`）各自抓到。 */
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gu

/** `<template>` 區塊。 */
const TEMPLATE_BLOCK_PATTERN = /<template\b[^>]*>([\s\S]*)<\/template>/u

/** HTML 註解。模板掃描前先剝掉，否則被註解掉的舊寫法或說明文字會被當成違規。 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/gu

/** 模板（純文字）用的三條規則比對式，都要求獨立詞或明確邊界，理由同 script 側的判準。 */
const TEMPLATE_EXP_PATTERN = /\bexp\b/gu
const TEMPLATE_NEW_DATE_PATTERN = /\bnew\s+Date\s*\(/gu
const TEMPLATE_DATE_NOW_PATTERN = /\bDate\s*\.\s*now\s*\(/gu
const TEMPLATE_TZ_STRING_PATTERN = new RegExp(TIMEZONE_MARK_PATTERN.source, 'gu')

// ---------------------------------------------------------------------------
// 偵測（兩種輸入各一支純函式——下面的自我檢查要拿它們去跑內建樣本）
// ---------------------------------------------------------------------------

/** `node` 是不是 `Math.exp`（唯一的例外，理由見檔頭「偽陽性代價」）。 */
const isMathExpMember = (node: ts.Identifier, sourceFile: ts.SourceFile): boolean => {
  const parent = node.parent
  return (
    ts.isPropertyAccessExpression(parent) && parent.name === node && parent.expression.getText(sourceFile) === 'Math'
  )
}

/** 一個節點若是字串／樣板字面值，回傳它包含的所有靜態文字片段；否則回空陣列。 */
const literalTextsOf = (node: ts.Node): string[] => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
  }
  return []
}

/**
 * TypeScript 原始碼裡的三條規則，走 AST。
 *
 * @param lineOffset 這段程式碼在原檔案裡的起始行（0-based）。`.vue` 的 `<script>` 區塊要靠它
 *   把行號加回去，否則報出來的位置永遠是「script 區塊內的第幾行」。
 */
const findViolationsInScript = (code: string, file: string, lineOffset: number, domain: Domain): Violation[] => {
  const sourceFile = ts.createSourceFile('scan.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []

  const record = (node: ts.Node, rule: Rule, detail: string): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    violations.push({
      file,
      line: line + 1 + lineOffset,
      column: character + 1,
      rule,
      source: node.getText(sourceFile).split('\n')[0]?.trim() ?? '',
      detail,
    })
  }

  const visit = (node: ts.Node): void => {
    if (domain.exp && ts.isIdentifier(node) && node.text === 'exp' && !isMathExpMember(node, sourceFile)) {
      record(
        node,
        'exp-leak',
        'exp 是 envelope 的絕對截止時刻，唯一用途是寫進 log／錯誤回報（§3.7）；' +
          '顯示路徑（.vue／view.ts／format）一律不得引用它',
      )
    }

    if (domain.newDate) {
      if (ts.isNewExpression(node) && DATE_CALLEE_PATTERN.test(node.expression.getText(sourceFile))) {
        record(
          node,
          'stray-new-date',
          'new Date(...) 會把業務時間字串依裝置時區重新解讀一次（§9.2）；' +
            '顯示與計算一律走 shared/format/ 的字串函式，不經過 Date',
        )
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'now' &&
        DATE_CALLEE_PATTERN.test(node.expression.expression.getText(sourceFile))
      ) {
        record(
          node,
          'stray-new-date',
          'Date.now(...) 同上；系統時間只能由 shared/format/business-clock.ts 或 session 模組' + '（已列白名單）取得',
        )
      }
    }

    if (domain.tzString) {
      const texts = literalTextsOf(node)
      if (texts.length > 0 && texts.some((text) => TIMEZONE_MARK_PATTERN.test(text))) {
        record(
          node,
          'tz-string',
          '這個字面值帶時區標記（+08:00／-08:00／T 分隔／結尾 Z）——業務時間字串不會長這樣，' +
            '它只可能是 rqTS／rspTS／exp 漏出來的（§9.2）',
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

/** 模板（純文字）裡的三條規則。行號由「這個位置之前有幾個換行」算出來。 */
const findViolationsInTemplate = (template: string, file: string, lineOffset: number, domain: Domain): Violation[] => {
  // 註解換成等長的空白，位置才不會位移——直接刪掉的話後面每一則違規的行號都會少算。
  const scanned = template.replace(HTML_COMMENT_PATTERN, (comment) => comment.replaceAll(/[^\n]/gu, ' '))
  const violations: Violation[] = []

  const record = (index: number, matched: string, rule: Rule, detail: string): void => {
    const before = scanned.slice(0, index)
    const line = before.split('\n').length
    const lastBreak = before.lastIndexOf('\n')
    violations.push({ file, line: line + lineOffset, column: index - lastBreak, rule, source: matched.trim(), detail })
  }

  if (domain.exp) {
    for (const match of scanned.matchAll(TEMPLATE_EXP_PATTERN)) {
      record(match.index, match[0], 'exp-leak', '模板裡出現 exp——它只供 log 與錯誤回報，不得上畫面（§3.7、§9.2）')
    }
  }

  if (domain.newDate) {
    for (const match of scanned.matchAll(TEMPLATE_NEW_DATE_PATTERN)) {
      record(match.index, match[0], 'stray-new-date', '模板裡的 new Date(...) 同 script 側，見上方說明')
    }
    for (const match of scanned.matchAll(TEMPLATE_DATE_NOW_PATTERN)) {
      record(match.index, match[0], 'stray-new-date', '模板裡的 Date.now(...) 同 script 側，見上方說明')
    }
  }

  if (domain.tzString) {
    for (const match of scanned.matchAll(TEMPLATE_TZ_STRING_PATTERN)) {
      record(match.index, match[0], 'tz-string', '模板裡出現帶時區標記的字面值，理由同 script 側')
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出 `WEB_SRC_ROOT` 底下所有要掃的檔案，跳過產生物目錄。 */
const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return []

  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const rel = relFromWebSrc(path)
    const relWithTrailingSlash = entry.isDirectory() ? `${rel}/` : rel
    if (relWithTrailingSlash.startsWith(EXCLUDED_PREFIX)) continue

    if (entry.isDirectory()) {
      found.push(...listFiles(path))
      continue
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path)
  }
  return found
}

/** 某個位置在檔案裡的 0-based 行號。 */
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length - 1

/** 一段被抽出來的區塊：內容 ＋ 它在原檔的起始行（0-based）。 */
type SourceBlock = { readonly code: string; readonly lineOffset: number }

if (!existsSync(WEB_SRC_ROOT)) {
  abort([
    `找不到前端原始碼目錄，這次掃描等於沒跑：`,
    `  ✗ ${repoPath(WEB_SRC_ROOT)}`,
    '    目錄可能搬家了，請一併修正本腳本的 WEB_SRC_ROOT，不要把這個檢查停掉。',
  ])
}

const files = listFiles(WEB_SRC_ROOT)

const violations: Violation[] = []
let vueFileCount = 0
let scriptBlockCount = 0
let templateBlockCount = 0
let pagesFileCount = 0
let sharedFormatFileCount = 0

for (const file of files) {
  const rel = relFromWebSrc(file)
  const isVue = file.endsWith('.vue')
  const domain = domainOf(rel, isVue)

  if (rel.startsWith(PAGES_PREFIX)) pagesFileCount += 1
  if (rel.startsWith(SHARED_FORMAT_PREFIX)) sharedFormatFileCount += 1

  // 三條規則對這個檔案都不適用（例如 stores/、router/ 底下的 .ts，只受 new Date 規則約束，
  // 那條會是 true，所以真正會進到這裡的只有理論上三者皆否的情形——留著這個提前跳出純粹是
  // 避免對不需要的檔案做多餘的 AST 剖析）。
  if (!domain.exp && !domain.tzString && !domain.newDate) continue

  const source = readFileSync(file, 'utf8')
  const path = repoPath(file)

  if (!isVue) {
    violations.push(...findViolationsInScript(source, path, 0, domain))
    continue
  }

  vueFileCount += 1

  const scriptBlocks: SourceBlock[] = [...source.matchAll(SCRIPT_BLOCK_PATTERN)].map((match) => ({
    code: match[1] ?? '',
    lineOffset: lineOf(source, match.index + match[0].indexOf('>') + 1),
  }))
  scriptBlockCount += scriptBlocks.length
  for (const block of scriptBlocks) {
    violations.push(...findViolationsInScript(block.code, path, block.lineOffset, domain))
  }

  const templateMatch = TEMPLATE_BLOCK_PATTERN.exec(source)
  if (templateMatch !== null) {
    templateBlockCount += 1
    const offset = lineOf(source, templateMatch.index + templateMatch[0].indexOf('>') + 1)
    violations.push(...findViolationsInTemplate(templateMatch[1] ?? '', path, offset, domain))
  }
}

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 六個下限，分兩層：
 *
 * 1. **檔案真的掃到了嗎**（前三項，與 `check-number-cast.ts` 同構）：目錄存在、掃到檔案、
 *    `.vue` 拆得出 `<script>`。
 * 2. **路徑分類真的認得出定義域嗎**（第 4、5 項）：`pages/`／`shared/format/` 各自的檔案數
 *    必須 > 0。這一項是這支腳本特有的失效模式——`domainOf` 的字串前綴比對只要在 Windows
 *    路徑分隔符正規化上出一點差錯（例如漏了 `replaceAll('\\', '/')`），三條規則會在**真實檔案**
 *    上全部靜默停止命中，而下面的內建樣本測試是拿**寫死的字串**直接餵給偵測函式，完全繞過
 *    `domainOf`，測不出這種壞法。兩層都要驗證，缺一層都可能是「規則已死但看起來在跑」。
 * 3. **判斷邏輯還認得出違規嗎**（最後六項）：拿內建樣本跑三條規則的 script 與 template
 *    兩種輸入，命中數不對就失敗。這一項不依賴 repo 現況——即使 `pages/` 乾淨到一則違規都
 *    沒有，它仍然證明得了這支腳本擋得住東西（通用規範 §7.1 要求的紅燈證據，做成每次都跑一遍）。
 */
const selfCheckFailures: string[] = []

if (files.length === 0) {
  selfCheckFailures.push(`掃到 0 個檔案（${repoPath(WEB_SRC_ROOT)}）：這次掃描等於沒跑`)
}
if (vueFileCount > 0 && scriptBlockCount === 0) {
  selfCheckFailures.push(`掃到 ${String(vueFileCount)} 個 .vue 卻一個 <script> 區塊都沒抽到：區塊比對式壞了`)
}
if (pagesFileCount === 0) {
  selfCheckFailures.push('pages/ 底下一個檔案都沒算到：路徑分類（domainOf）可能壞了，三條規則對真實頁面都會停止命中')
}
if (sharedFormatFileCount === 0) {
  selfCheckFailures.push(
    'shared/format/ 底下一個檔案都沒算到：路徑分類可能壞了——後果不只是 exp 規則漏掃 format 模組，' +
      'new Date 規則還會反過來對 format 模組自己合法的 new Date() 誤報',
  )
}

const SELF_TEST_DOMAIN: Domain = { exp: true, tzString: true, newDate: true }

const SELF_TEST_SCRIPT = [
  'const a = exp',
  'const b = row.exp',
  'const c = { exp }',
  'const d = Math.exp(2)', // Math.exp：唯一的例外，不算
  'const e = expForLog', // 不同識別字，不算
  'const f = expiresIn', // 不同識別字，不算
  'const g = new Date()',
  "const h = new Date('2026-08-29')",
  'const i = Date.now()',
  'const j = new globalThis.Date()',
  'const k = someDate.getTime()', // 不是 new Date(，不算
  'const l = new CustomDate()', // 不是全域 Date，不算
  "const m = '+08:00 offset alone'",
  "const n = 'ends with -08:00'",
  "const o = '2026-08-29T00:15:00'",
  "const p = 'time 00:15:00Z suffix'",
  "const q = '2026-08-29 00:15:00'", // 業務時間格式（空白分隔、無標記），不算
  'const r = row.rqTS', // 識別字，不是字面值，這條規則讀不到，不算
].join('\n')

const SELF_TEST_SCRIPT_EXPECTED: Record<Rule, number> = { 'exp-leak': 3, 'stray-new-date': 4, 'tz-string': 4 }

const SELF_TEST_TEMPLATE = [
  '<span>{{ exp }}</span>',
  '<span>{{ expForLog }}</span>',
  '<span :title="exp">static</span>',
  '<!-- {{ exp }} 註解不算 -->',
  '<span>{{ new Date() }}</span>',
  '<span>{{ Date.now() }}</span>',
  '<span>{{ formatDate(row.date) }}</span>',
  "<span>{{ '+08:00 offset alone' }}</span>",
  '<span :title="\'ends with -08:00\'">x</span>',
  "<span>{{ '2026-08-29T00:15:00' }}</span>",
  "<span>{{ 'time 00:15:00Z suffix' }}</span>",
  "<!-- '2026-08-29T00:15:00+08:00' 註解不算 -->",
].join('\n')

const SELF_TEST_TEMPLATE_EXPECTED: Record<Rule, number> = { 'exp-leak': 2, 'stray-new-date': 2, 'tz-string': 4 }

const countByRule = (items: readonly Violation[]): Record<Rule, number> => {
  const counts: Record<Rule, number> = { 'exp-leak': 0, 'stray-new-date': 0, 'tz-string': 0 }
  for (const item of items) counts[item.rule] += 1
  return counts
}

const selfTestScriptHits = countByRule(findViolationsInScript(SELF_TEST_SCRIPT, '<self-test>', 0, SELF_TEST_DOMAIN))
const selfTestTemplateHits = countByRule(
  findViolationsInTemplate(SELF_TEST_TEMPLATE, '<self-test>', 0, SELF_TEST_DOMAIN),
)

for (const rule of Object.keys(SELF_TEST_SCRIPT_EXPECTED) as Rule[]) {
  const expected = SELF_TEST_SCRIPT_EXPECTED[rule]
  const actual = selfTestScriptHits[rule]
  if (actual !== expected) {
    selfCheckFailures.push(
      `內建樣本（程式碼／${rule}）應命中 ${String(expected)} 則，實際 ${String(actual)} 則：AST 判斷已經失效`,
    )
  }
}
for (const rule of Object.keys(SELF_TEST_TEMPLATE_EXPECTED) as Rule[]) {
  const expected = SELF_TEST_TEMPLATE_EXPECTED[rule]
  const actual = selfTestTemplateHits[rule]
  if (actual !== expected) {
    selfCheckFailures.push(
      `內建樣本（模板／${rule}）應命中 ${String(expected)} 則，實際 ${String(actual)} 則：模板比對式已經失效`,
    )
  }
}

if (selfCheckFailures.length > 0) {
  abort([
    '時區外洩掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

const RULE_LABEL: Record<Rule, string> = {
  'exp-leak': 'exp 出現在顯示路徑',
  'tz-string': '帶時區標記的字面值',
  'stray-new-date': 'format 模組以外的 new Date(／Date.now(',
}

if (violations.length > 0) {
  const byRule = countByRule(violations)
  const summary = (['exp-leak', 'tz-string', 'stray-new-date'] as const)
    .filter((rule) => byRule[rule] > 0)
    .map((rule) => `${RULE_LABEL[rule]} ${String(byRule[rule])} 處`)
    .join('、')

  process.stderr.write(
    [
      `發現帶時區偏移的時間資訊外洩（共 ${String(violations.length)} 處：${summary}；前端規範 §9.2／§3.7）：`,
      ...violations.map(({ file, line, column, rule, source, detail }) =>
        [
          `  ✗ [${RULE_LABEL[rule]}] ${file}:${String(line)}:${String(column)}`,
          `      ${source}`,
          `      ${detail}`,
        ].join('\n'),
      ),
      '',
      '正確寫法：',
      '  時間顯示／裁切  apps/web/src/shared/format/business-date.ts（formatDate／formatDateTime／formatYearMonth）',
      '  取得「現在」    apps/web/src/shared/format/business-clock.ts（todayInTaipei）',
      '  session 到期    expiresIn 換算的 deadline（apps/web/src/shared/api/session-deadline.ts），不是 exp',
      '',
      '若被擋下來的是字串常值巧合命中（例如商品編號剛好是 T 分隔格式），',
      '本規則刻意不分辨語意，理由與代價完整寫在 apps/api/scripts/check-tz-leak.ts 檔頭。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `時區外洩檢查通過：${String(files.length)} 個檔案（含 ${String(vueFileCount)} 個 .vue／` +
    `${String(scriptBlockCount)} 個 <script> 區塊、${String(templateBlockCount)} 個 <template> 區塊、` +
    `${String(pagesFileCount)} 個 pages/ 檔案、${String(sharedFormatFileCount)} 個 shared/format/ 檔案），` +
    `沒有 exp 外洩、沒有帶時區標記的字面值、沒有遊蕩的 new Date(／Date.now(。\n`,
)
