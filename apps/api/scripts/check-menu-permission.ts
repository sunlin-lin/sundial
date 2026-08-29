/**
 * 選單權限掃描：把使用者剛講明的一條規則從「只存在於對話裡」變成一支會擋人的檢查。
 *
 * ## 這條規則在說什麼
 *
 * 1. **大目錄（`MenuGroup`）本身沒有權限碼，不可能有。** 它能不能出現，完全由「底下有沒有
 *    可見項目」推導（`menu/main-menu.ts` 的 `visibleMenuGroups` 最後一步就是
 *    `.filter((group) => group.items.length > 0)`）。給分組一個獨立權限碼，會產生兩種
 *    互相獨立、卻都無法被任何工具擋住的錯誤形狀：「有分組權限但底下每一項都沒權限」
 *    → 使用者看到一個點不進去的空分組；反過來「沒有分組權限但有底下的功能」
 *    → 那個功能對這個角色而言等於不存在。兩種都只能靠人記得同步兩處，而不同步不會報錯。
 *    這支腳本擋的是**起點**：不讓 `MenuGroup` 型別長出 `permissionCode` 這個欄位，
 *    上面兩種錯誤形狀就沒有地方可以發生。
 *
 * 2. **選單項的權限碼必須是「顯示這一頁資料」的那個動作**（讀取類：`list`／`overview`／
 *    `tree`／`get`／`resolve`／`context` 這種），不能是異動類（`create`／`update`／`delete`
 *    這種）。理由：使用者若只有異動類權限、沒有讀取類權限，會出現「看得到入口卻進去一片空白」
 *    ——沒有列表權限就看不到任何資料，只有修改權限的人進到頁面只看得到空的表單或空的表格。
 *    把入口露給他，是把「有權限」誤導成「能用」。
 *
 * 3. **選單項的 `permissionCode` 必須與該頁 `.route.ts` 的 `meta.permission` 相同，且
 *    `routeName` 對得上。** `menu/main-menu.ts` 的 `MenuItem.permissionCode` 檔頭本來就寫了
 *    這件事、也寫了兩邊填錯的後果不對稱（選單填錯讓有權限的人看不到入口，路由填錯才會擋錯人）
 *    ——這支腳本把那段註解升格成真的會紅的檢查。
 *
 * ## 判準：AST，不是正則
 *
 * 三條規則都在問「這個物件字面值／型別宣告長什麼樣子」，不是在比對一段可能跨越多行、
 * 縮排與換行方式各異的文字——`MenuGroup` 的型別宣告、`MAIN_MENU` 裡巢狀的物件字面值、
 * 各 `.route.ts` 裡 `meta: { permission: ... }` 的巢狀屬性，正則要嘛需要為每一種寫法各補一條
 * pattern，要嘛乾脆漏判（多一個換行、多一層空白就不中）。走 TypeScript 的 AST
 * （`ts.createSourceFile`）之後，「找一個名叫 `permissionCode` 的 `PropertySignature`」
 * 或「找一個帶 `routeName` 屬性的 `ObjectLiteralExpression`」都是結構化查詢，
 * 跟原始碼怎麼排版無關。與 `check-audit-transaction.ts` 同一個理由，這裡不重複展開。
 *
 * ## 否定表列的來源，以及它抓不到什麼
 *
 * 規則 2 用「異動類動作的否定表列」而不是「讀取類動作的肯定表列」，因為讀取類動作的取名
 * 在這個專案裡沒有收斂成固定幾個字（`list`／`overview`／`tree`／`get`／`resolve`／`context`
 * 都出現過，且未必只有這幾種），肯定表列會不斷追著新動詞跑；異動類動作的取名收斂得多。
 *
 * 這份否定表列**逐一讀過** `apps/api/drizzle/*_seed_permission_codes_*.sql`（截至本次撰寫，
 * 17 個 seed 檔）裡實際出現過的權限碼最後一段，篩出語意上會造成資料庫寫入的那些：
 *
 * ```
 * create update delete revoke leave reset-password activate deactivate
 * terminate copy logout logout-all
 * ```
 *
 * 外加 `revoke-other`——這個動作**目前還沒有出現在任何 migration 裡**，是
 * `docs/ui/23-ui-daily-attendance-records.md`（打卡明細撤銷）已經定案、但對應的權限碼
 * seed 尚未寫入資料庫的未來動作，先一併列入表列，以免那份 UI 文件落地時第一時間漏擋。
 *
 * **這份表列抓不到什麼（誠實寫下，不要讓下一個人以為它是全稱肯定）**：
 *
 * - **日後新增一個異動類動作、但取名不在上面這份清單裡**（例如 `approve`／`reject`／
 *   `assign`／`suspend`／`resume`／`lock`／`merge`），這支腳本不會發現它是異動類，
 *   會判它合法放進選單——這是名稱表列的天生上限，不是漏寫的 bug，維護者新增一種
 *   異動類端點時，必須記得回來把新動詞加進這份清單。
 * - **同一個字在不同網域可能語意不同**。例如 `resolve` 在
 *   `regulatory.datasets.resolve` 是查詢類（HTTP 200 + `data: null`，
 *   `regulatory-datasets.errors.ts` 已經這樣分類），但字面上看不出「resolve」本身
 *   一定是讀取還是寫入——這份表列只是排除了目前資料庫裡看過的、確定是寫入的那幾個詞，
 *   沒有辦法對還沒出現的詞做語意判斷。
 * - **只檢查權限碼最後一段的字面文字**，不檢查那個權限碼實際對應的端點是不是查詢類
 *   （後端規範 §1.3／§3.1 的查詢類 vs 動作類分野）。權限碼命名與端點實際行為若對不上
 *   （命名寫成 `xxx.list` 但後端其實接的是一支會寫入的端點），這支腳本看不出來，
 *   那是命名慣例本身要守住的事，不是這裡能補的。
 *
 * ## §7.2 自我檢查
 *
 * 掃到 0 個選單項、或掃到 0 支 `.route.ts` 時必須失敗（理由與 `check-audit-transaction.ts`
 * 相同：目錄搬家、檔名改掉，這支腳本會照跑、照綠、零命中，規則就在沒有人察覺的情況下失效）。
 * 另外用內建樣本驗證判斷邏輯本身：至少涵蓋三種違規（異動類權限碼、與路由 `meta.permission`
 * 不一致、`routeName` 對不到任何路由）與兩種合法形狀（沒有權限碼、讀取類權限碼且與路由一致），
 * 外加 `MenuGroup` 型別是否長出 `permissionCode` 欄位的獨立驗證（合法／違規各一種）。
 *
 * 執行：`bun run check:menu-permission`（已串進 `bun run ci`，緊接在 `check:tz-leak` 之後）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

/** repo 根目錄。從本檔位置推導：`apps/api/scripts/<this file>` 往上四層。 */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..')

/** `apps/web/src`。從本檔位置推導：往上三層到 `apps`，再進 `web/src`。 */
const WEB_SRC_ROOT = resolve(fileURLToPath(import.meta.url), '../../../web/src')

/** 選單資料結構所在目錄（前端規範 §0.2：選單是資料，不是目錄結構，只有這一個目錄）。 */
const MENU_DIR = join(WEB_SRC_ROOT, 'menu')

/** 頁面目錄根，`.route.ts` 全部在這底下（前端規範 §0.1）。 */
const PAGES_DIR = join(WEB_SRC_ROOT, 'pages')

/**
 * 異動類動作的否定表列。來源與抓不到什麼，見檔頭「否定表列的來源」一節。
 * 只比對權限碼**最後一段**（`split('.')` 取最後一個元素），例如
 * `attendance.records.revoke-other` 的最後一段是 `revoke-other`。
 */
const MUTATING_ACTIONS = new Set([
  'create',
  'update',
  'delete',
  'revoke',
  'revoke-other',
  'leave',
  'reset-password',
  'activate',
  'deactivate',
  'terminate',
  'copy',
  'logout',
  'logout-all',
])

/** 一則違規。位置一律寫成 `專案相對路徑:行號:欄號`，與 `check-audit-transaction.ts` 同格式。 */
type Violation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly detail: string
}

/** 直接把整支腳本判為不可信並中止（同 `check-audit-transaction.ts` 的 `abort`）。 */
function abort(lines: readonly string[]): never {
  process.stderr.write([...lines, ''].join('\n'))
  process.exit(1)
}

const repoPath = (absolutePath: string): string => relative(REPO_ROOT, absolutePath).replaceAll('\\', '/')

// ---------------------------------------------------------------------------
// 判斷邏輯（純函式，下面的自我檢查會拿它去跑內建樣本）
// ---------------------------------------------------------------------------

/** 物件字面值裡名叫 `name` 的 `PropertyAssignment`，找不到回傳 `undefined`。 */
const findProperty = (obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined =>
  obj.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name,
  )

/** 一個運算式是不是字面字串常值，是的話回傳它的值，否則回傳 `null`（含樣板字串等一律視為無法靜態驗證）。 */
const stringLiteralValue = (node: ts.Expression): string | null => (ts.isStringLiteral(node) ? node.text : null)

/** 從原始碼位置算出 1 起算的行列號，供回報用。 */
const positionOf = (sourceFile: ts.SourceFile, node: ts.Node): { readonly line: number; readonly column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: line + 1, column: character + 1 }
}

/**
 * 一個選單項字面值抽取出來的形狀。`routeName`／`permissionCode` 為 `null` 代表「屬性不存在」
 * 或「屬性存在但不是字面字串常值」——兩種都無法被本腳本靜態驗證，交由呼叫端各自判斷後果。
 */
type MenuItemRecord = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly source: string
  readonly routeName: string | null
  readonly hasPermissionCode: boolean
  readonly permissionCode: string | null
}

/**
 * 掃描原始碼裡所有「帶 `routeName` 屬性」的物件字面值，視為 `MenuItem`。
 *
 * 用「有沒有 `routeName` 屬性」當判準，而不是比對變數名 `MAIN_MENU`：`MenuGroup` 物件字面值
 * 帶的是 `items` 陣列，不帶 `routeName`，兩者天生就能用這個屬性分開，不需要額外認變數名，
 * 這也讓自我檢查可以直接餵一小段字串樣本、不必模擬整個 `export const MAIN_MENU = [...]` 外殼。
 */
const extractMenuItems = (code: string, file: string): readonly MenuItemRecord[] => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const items: MenuItemRecord[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const routeNameProperty = findProperty(node, 'routeName')
      if (routeNameProperty !== undefined) {
        const { line, column } = positionOf(sourceFile, node)
        const permissionCodeProperty = findProperty(node, 'permissionCode')
        items.push({
          file,
          line,
          column,
          source: node.getText(sourceFile).split('\n')[0]?.trim() ?? '',
          routeName: stringLiteralValue(routeNameProperty.initializer),
          hasPermissionCode: permissionCodeProperty !== undefined,
          permissionCode:
            permissionCodeProperty === undefined ? null : stringLiteralValue(permissionCodeProperty.initializer),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return items
}

/**
 * 規則一：`permissionCode` 的最後一段不得是異動類動作。
 * `permissionCode` 不是字面字串常值時，回傳一則「無法靜態驗證」的違規——本腳本只走語法樹，
 * 沒有能力對非字面值求值，與其悄悄放行，不如報出來讓人手動確認。
 */
const checkNotMutatingAction = (item: MenuItemRecord): Violation | null => {
  if (!item.hasPermissionCode) return null
  if (item.permissionCode === null) {
    return {
      file: item.file,
      line: item.line,
      column: item.column,
      source: item.source,
      detail: 'permissionCode 必須是字面字串常值才能被本掃描器檢查（規則一：是否為異動類動作）',
    }
  }
  const lastSegment = item.permissionCode.split('.').at(-1) ?? ''
  if (MUTATING_ACTIONS.has(lastSegment)) {
    return {
      file: item.file,
      line: item.line,
      column: item.column,
      source: item.source,
      detail:
        `permissionCode "${item.permissionCode}" 的最後一段 "${lastSegment}" 是異動類動作：` +
        `選單項只能掛「顯示這一頁資料」的讀取類權限碼（list／overview／tree 這種），` +
        `否則只有異動權限、沒有讀取權限的人會看到入口卻進去一片空白`,
    }
  }
  return null
}

/** `.route.ts` 抽取出來的形狀。`routeName`／`permission` 為 `null` 代表不存在或不是字面字串常值。 */
type RouteRecord = {
  readonly file: string
  readonly routeName: string | null
  readonly permission: string | null
}

/**
 * 掃描一支 `.route.ts`，找出**帶 `component` 屬性**的物件字面值（`RouteRecordRaw` 的識別特徵，
 * 不認變數名——`export const route = {...}` 是既有慣例，但沒有理由假設它是唯一合法的變數名），
 * 取出 `name` 與巢狀的 `meta.permission`。找不到符合條件的物件字面值回傳 `null`。
 */
const extractRoute = (code: string, file: string): RouteRecord | null => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let result: RouteRecord | null = null

  const visit = (node: ts.Node): void => {
    if (result === null && ts.isObjectLiteralExpression(node) && findProperty(node, 'component') !== undefined) {
      const nameProperty = findProperty(node, 'name')
      const routeName = nameProperty === undefined ? null : stringLiteralValue(nameProperty.initializer)

      let permission: string | null = null
      const metaProperty = findProperty(node, 'meta')
      if (metaProperty !== undefined && ts.isObjectLiteralExpression(metaProperty.initializer)) {
        const permissionProperty = findProperty(metaProperty.initializer, 'permission')
        if (permissionProperty !== undefined) permission = stringLiteralValue(permissionProperty.initializer)
      }

      result = { file, routeName, permission }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return result
}

/**
 * 規則二：帶 `permissionCode` 的選單項，必須找得到一支 `routeName` 相同的 `.route.ts`，
 * 且該路由的 `meta.permission` 等於這個 `permissionCode`。
 */
const checkMatchesRoute = (item: MenuItemRecord, routes: readonly RouteRecord[]): Violation | null => {
  if (!item.hasPermissionCode) return null
  if (item.routeName === null) {
    return {
      file: item.file,
      line: item.line,
      column: item.column,
      source: item.source,
      detail: 'routeName 必須是字面字串常值才能被本掃描器檢查（規則二：是否與路由的 meta.permission 一致）',
    }
  }

  const matchedRoute = routes.find((route) => route.routeName === item.routeName)
  if (matchedRoute === undefined) {
    return {
      file: item.file,
      line: item.line,
      column: item.column,
      source: item.source,
      detail: `找不到 routeName "${item.routeName}" 對應的 .route.ts——選單項指向一個不存在的路由名稱`,
    }
  }

  if (matchedRoute.permission !== item.permissionCode) {
    return {
      file: item.file,
      line: item.line,
      column: item.column,
      source: item.source,
      detail:
        `permissionCode "${String(item.permissionCode)}" 與 ${repoPath(matchedRoute.file)} 的 ` +
        `meta.permission (${matchedRoute.permission === null ? '未設定' : `"${matchedRoute.permission}"`}) 不一致：` +
        '兩邊必須是同一個值，選單負責藏入口，路由負責擋直接貼網址與過期的書籤',
    }
  }

  return null
}

/** 規則三：`MenuGroup` 型別宣告不得出現 `permissionCode` 欄位。回傳所有違規的型別成員節點位置。 */
const checkMenuGroupTypeHasNoPermissionCode = (code: string, file: string): readonly Violation[] => {
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: Violation[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'MenuGroup' && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === 'permissionCode') {
          const { line, column } = positionOf(sourceFile, member)
          violations.push({
            file,
            line,
            column,
            source: member.getText(sourceFile).trim(),
            detail:
              'MenuGroup 型別不得有 permissionCode 欄位：大目錄的可見性完全由「底下有沒有可見項目」推導，' +
              '給分組一個獨立權限碼會產生「有分組權限但底下全部沒權限」（空分組）與「沒有分組權限但有底下的功能」' +
              '（功能等於不存在）兩種只能靠人工同步、不同步也不會報錯的錯誤形狀',
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下符合條件的檔案。 */
const listFiles = (directory: string, predicate: (name: string) => boolean): string[] => {
  if (!existsSync(directory)) return []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(path, predicate))
      continue
    }
    if (predicate(entry.name)) found.push(path)
  }
  return found
}

/** 選單原始碼檔案：`menu/` 底下的 `.ts`，排除測試檔——測試檔裡不會有真的 `MAIN_MENU` 資料。 */
const menuFiles = listFiles(MENU_DIR, (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))

/** 所有頁面路由宣告。 */
const routeFiles = listFiles(PAGES_DIR, (name) => name.endsWith('.route.ts'))

const routes: RouteRecord[] = routeFiles.map((file) => {
  const record = extractRoute(readFileSync(file, 'utf8'), repoPath(file))
  return record ?? { file: repoPath(file), routeName: null, permission: null }
})

const menuItems: MenuItemRecord[] = menuFiles.flatMap((file) =>
  extractMenuItems(readFileSync(file, 'utf8'), repoPath(file)),
)

const typeViolations: Violation[] = menuFiles.flatMap((file) =>
  checkMenuGroupTypeHasNoPermissionCode(readFileSync(file, 'utf8'), repoPath(file)),
)

const violations: Violation[] = [
  ...typeViolations,
  ...menuItems.flatMap((item) => {
    const found: Violation[] = []
    const mutatingViolation = checkNotMutatingAction(item)
    if (mutatingViolation !== null) found.push(mutatingViolation)
    const routeViolation = checkMatchesRoute(item, routes)
    if (routeViolation !== null) found.push(routeViolation)
    return found
  }),
]

// ---------------------------------------------------------------------------
// 掃描器的自我檢查（通用規範 §7.2）
// ---------------------------------------------------------------------------

/**
 * 內建樣本涵蓋三種違規與兩種合法選單項形狀，外加 `MenuGroup` 型別的合法／違規各一種：
 *
 * 選單項（`SELF_TEST_MENU_SOURCE`，5 項）：
 * 1. `legalNoPermission`：沒有 `permissionCode` → 合法（首頁那種登入即可見的項目）。
 * 2. `legalList`：`permissionCode` 為 `demo.foo.list`，對應路由 `meta.permission` 相同
 *    → 合法（讀取類、與路由一致）。
 * 3. `mutating`：`permissionCode` 為 `demo.foo.update`，對應路由 `meta.permission` 也是
 *    `demo.foo.update`（刻意讓路由端一致，證明只有規則一單獨命中，不是規則二順便命中）
 *    → 違規（異動類動作）。
 * 4. `mismatch`：`permissionCode` 為 `demo.foo.overview`（讀取類，規則一不會命中），
 *    但對應路由的 `meta.permission` 是 `demo.foo.other` → 違規（與路由不一致）。
 * 5. `orphan`：`permissionCode` 為 `demo.foo.tree`（讀取類），`routeName` 指向一個
 *    不存在的路由 `no-such-route` → 違規（找不到對應路由）。
 *
 * `MenuGroup` 型別（另外兩段獨立樣本，不與上面混在同一份原始碼——兩個同名型別宣告在同一個
 * 檔案裡雖然語法上解析得過，但會讓「有沒有 permissionCode」這件事在兩個宣告間混淆，
 * 分開驗證才乾淨）：
 * - `SELF_TEST_MENU_GROUP_OK`：`MenuGroup` 沒有 `permissionCode` → 合法。
 * - `SELF_TEST_MENU_GROUP_BAD`：`MenuGroup` 多了 `permissionCode?: string` → 違規。
 *
 * 預期：5 個選單項、3 則選單項違規（mutating、mismatch、orphan）。
 */
const SELF_TEST_MENU_SOURCE = [
  'export type MenuItem = { readonly labelKey: string; readonly routeName: string; readonly permissionCode?: string }',
  'export type MenuGroup = { readonly labelKey: string; readonly items: readonly MenuItem[] }',
  'export const MAIN_MENU: readonly MenuGroup[] = [',
  '  {',
  "    labelKey: 'menu.demo',",
  '    items: [',
  "      { labelKey: 'demo.a', routeName: 'legal-no-permission' },",
  "      { labelKey: 'demo.b', routeName: 'legal-list', permissionCode: 'demo.foo.list' },",
  "      { labelKey: 'demo.c', routeName: 'mutating-route', permissionCode: 'demo.foo.update' },",
  "      { labelKey: 'demo.d', routeName: 'mismatch-route', permissionCode: 'demo.foo.overview' },",
  "      { labelKey: 'demo.e', routeName: 'no-such-route', permissionCode: 'demo.foo.tree' },",
  '    ],',
  '  },',
  ']',
].join('\n')

const SELF_TEST_ROUTES: readonly RouteRecord[] = [
  { file: '<self-test>/legal-list.route.ts', routeName: 'legal-list', permission: 'demo.foo.list' },
  { file: '<self-test>/mutating-route.route.ts', routeName: 'mutating-route', permission: 'demo.foo.update' },
  { file: '<self-test>/mismatch-route.route.ts', routeName: 'mismatch-route', permission: 'demo.foo.other' },
]

const SELF_TEST_MENU_GROUP_OK = [
  'export type MenuItem = { readonly routeName: string }',
  'export type MenuGroup = { readonly labelKey: string; readonly items: readonly MenuItem[] }',
].join('\n')

const SELF_TEST_MENU_GROUP_BAD = [
  'export type MenuItem = { readonly routeName: string }',
  'export type MenuGroup = { readonly labelKey: string; readonly items: readonly MenuItem[]; readonly permissionCode?: string }',
].join('\n')

const SELF_TEST_EXPECTED_ITEM_COUNT = 5
const SELF_TEST_EXPECTED_ITEM_VIOLATIONS = 3

const selfCheckFailures: string[] = []

// 命中 0 個選單項、或 0 支 .route.ts 必須失敗（§7.2）：目錄搬家、檔名改掉，
// 這支腳本會照跑、照綠、零命中，規則就在沒有人察覺的情況下失效。
if (menuItems.length === 0) {
  selfCheckFailures.push(`${repoPath(MENU_DIR)} 底下找不到任何帶 routeName 的選單項：這次掃描等於沒跑`)
}
if (routeFiles.length === 0) {
  selfCheckFailures.push(`${repoPath(PAGES_DIR)} 底下找不到任何 .route.ts：規則二的比對對象消失了`)
}

const selfTestItems = extractMenuItems(SELF_TEST_MENU_SOURCE, '<self-test>')
if (selfTestItems.length !== SELF_TEST_EXPECTED_ITEM_COUNT) {
  selfCheckFailures.push(
    `內建樣本應找到 ${String(SELF_TEST_EXPECTED_ITEM_COUNT)} 個選單項，` +
      `實際 ${String(selfTestItems.length)} 個：選單項的辨識邏輯（有沒有 routeName 屬性）已經失效`,
  )
}

const selfTestViolations = selfTestItems.flatMap((item) => {
  const found: Violation[] = []
  const mutatingViolation = checkNotMutatingAction(item)
  if (mutatingViolation !== null) found.push(mutatingViolation)
  const routeViolation = checkMatchesRoute(item, SELF_TEST_ROUTES)
  if (routeViolation !== null) found.push(routeViolation)
  return found
})
if (selfTestViolations.length !== SELF_TEST_EXPECTED_ITEM_VIOLATIONS) {
  selfCheckFailures.push(
    `內建樣本應命中 ${String(SELF_TEST_EXPECTED_ITEM_VIOLATIONS)} 則選單項違規（異動類動作／` +
      `與路由不一致／找不到路由各一），實際 ${String(selfTestViolations.length)} 則：` +
      '規則一、規則二的判斷邏輯已經失效',
  )
}

const menuGroupOkViolations = checkMenuGroupTypeHasNoPermissionCode(SELF_TEST_MENU_GROUP_OK, '<self-test>')
if (menuGroupOkViolations.length !== 0) {
  selfCheckFailures.push('內建樣本（合法的 MenuGroup 型別，沒有 permissionCode）不應該被判為違規，但規則三命中了')
}

const menuGroupBadViolations = checkMenuGroupTypeHasNoPermissionCode(SELF_TEST_MENU_GROUP_BAD, '<self-test>')
if (menuGroupBadViolations.length !== 1) {
  selfCheckFailures.push(
    `內建樣本（MenuGroup 型別多了 permissionCode 欄位）應該命中 1 則違規，` +
      `實際 ${String(menuGroupBadViolations.length)} 則：規則三的判斷邏輯已經失效`,
  )
}

if (selfCheckFailures.length > 0) {
  abort([
    '選單權限掃描器自我檢查失敗（掃描結果不可信，一律視為失敗）：',
    ...selfCheckFailures.map((line) => `  ✗ ${line}`),
  ])
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  process.stderr.write(
    [
      `選單權限違反使用者定案的三條規則之一（${String(violations.length)} 處違規）：`,
      ...violations.map(({ file, line, column, source, detail }) =>
        [`  ✗ ${file}:${String(line)}:${String(column)}`, `      ${source}`, `      ${detail}`].join('\n'),
      ),
      '',
      '修法：',
      '  1. 選單項的 permissionCode 必須是讀取類動作（list／overview／tree 這種），不是',
      '     create／update／delete 這種異動類動作——沒有讀取權限的人看到入口只會遇到空白畫面。',
      '  2. permissionCode 必須與對應 .route.ts 的 meta.permission 完全相同，routeName 必須對得上',
      '     真的存在的路由。',
      '  3. MenuGroup 型別不得加 permissionCode 欄位——大目錄的可見性只能由底下項目推導，',
      '     不能自己有一個獨立的權限碼。',
      '完整理由見 apps/api/scripts/check-menu-permission.ts 檔頭，以及',
      'docs/dev-standards-frontend.md §4.4。',
    ].join('\n') + '\n',
  )
  process.exit(1)
}

process.stdout.write(
  `選單權限檢查通過：${String(menuFiles.length)} 個選單檔案、${String(menuItems.length)} 個選單項、` +
    `${String(routeFiles.length)} 支路由，全部符合三條規則。\n`,
)
