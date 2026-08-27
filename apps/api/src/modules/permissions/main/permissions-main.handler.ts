/**
 * `permissions/main` 的端點 handler（§0.4：handler 不拆）。
 *
 * 每個函式只做三件事：取出驗證後的輸入 → 呼叫 service → 把結果收成本端點的 `data` 形狀
 * （§1.8.0 的④與⑥）。它在結構上不會長大，因此沒有可拆的東西。
 *
 * **不自行設定 `code`／`rspTS`／`cmd`／`locale`／`expiresIn`／`exp`**（§1.8.2）：
 * 回傳一律經過 `ok()`，其餘欄位由出口層補。手工組信封不會有任何編譯錯誤，只會讓前端
 * 的統一處理在某幾支端點上靜靜失效。
 *
 * 回應型別在**本檔**宣告、由 `*.routes.ts` import，不是反過來：routes 已經 import 本檔的
 * handler 函式，兩邊互相 import 會形成循環相依。routes 那邊的 TypeBox schema 是同一組形狀的
 * 執行期版本。
 */
import type { Database } from '../../../db/client.ts'
import { ok, type EnvelopeBody } from '../../../shared/envelope.ts'
import type { PermissionNode } from './domain/permission-tree.ts'
import { loadPermissionTree } from './permissions-main.service.ts'

/** 由組裝點注入的相依。本次目錄只讀全域的 `permissions` 表，因此不需要 clock，也沒有公司範圍。 */
export type PermissionsMainDependencies = {
  readonly database: Database
}

export type PermissionNodeView = {
  readonly id: string
  /** 權限碼，等於端點路徑的機械轉換結果（§5.2.2）。 */
  readonly code: string
  readonly name: string
  readonly description: string | null
  /** `false` 代表這是純分類節點，只供樹狀顯示與批次勾選，授予它不會生效（UI §權限樹）。 */
  readonly isAssignable: boolean
  readonly sortOrder: number
  readonly children: PermissionNodeView[]
}

export type PermissionTreeView = {
  readonly nodes: PermissionNodeView[]
}

/**
 * service 的樹 → 端點的 `data`。
 *
 * 目前兩者的欄位剛好一樣，但仍然逐欄寫出來（§2、§1.8.0）：共用型別的話，
 * `permissions` 資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變。
 * 這正是個資外洩最常見的路徑。
 */
const toNodeView = (node: PermissionNode): PermissionNodeView => ({
  id: node.id,
  code: node.code,
  name: node.name,
  description: node.description,
  isAssignable: node.isAssignable,
  sortOrder: node.sortOrder,
  children: node.children.map(toNodeView),
})

/** `POST /permissions/main/tree`。查無資料回空陣列，不是 `null`、更不是 404（§1.3、§3.1.3）。 */
export const treePermissionsHandler = async (
  dependencies: PermissionsMainDependencies,
): Promise<EnvelopeBody<PermissionTreeView>> => {
  const nodes = await loadPermissionTree(dependencies.database)
  return ok({ nodes: nodes.map(toNodeView) })
}
