/**
 * 權限樹的組裝規則（零 IO 純函式，§0.4 的 `domain/`）。
 *
 * 之所以在這裡把「扁平列 → 樹」獨立出來，而不是讓 repository 直接回巢狀結構：
 * 遞迴組裝有三個會靜靜出錯的地方——順序、孤兒節點、環路——而這三件事在資料庫回傳的
 * 那一刻都還看不出來。放進純函式，它們才有辦法被逐條測試（`__tests__/permission-tree.test.ts`）；
 * 留在查詢裡的話，要測就得先有一個資料庫，於是實務上不會有人測。
 */

/** 組裝樹所需的最小輸入。刻意不沿用 Drizzle 的 row 型別：那會讓資料表加欄位就自動流進本層（§1.8.0）。 */
export type PermissionRow = {
  readonly id: string
  /** 根節點為 `null`。 */
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly isAssignable: boolean
  readonly sortOrder: number
}

export type PermissionNode = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly isAssignable: boolean
  readonly sortOrder: number
  readonly children: readonly PermissionNode[]
}

/**
 * 同層排序：先 `sortOrder`，再 `code`。
 *
 * 第二個鍵不是裝飾：`sort_order` 的預設值是 0（見 `db/schema/permissions.ts`），
 * 因此同分是常態而不是例外，而 `Array.prototype.sort` 只保證穩定於「輸入順序」
 * ——輸入順序來自資料庫，同分時它可以每次都不一樣。少了 `code` 這個決勝鍵，
 * 使用者每次打開角色設定頁看到的權限順序都可能不同，而沒有任何一處會報錯。
 */
const compareSiblings = (left: PermissionRow, right: PermissionRow): number => {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  if (left.code === right.code) return 0
  return left.code < right.code ? -1 : 1
}

/**
 * 環路偵測。
 *
 * `permissions.parent_id` 是自關聯外鍵，資料庫**擋不住** A→B→A 這種環：外鍵只要求對得到一列，
 * 不管那一列繞回來沒有。而環上的節點永遠不會出現在任何一棵樹裡（它們沒有根），
 * 於是症狀是「某些權限在設定頁上憑空消失」，不是任何錯誤訊息。
 *
 * 走到環路時**拋例外**：這是資料損毀，屬系統錯誤路徑（§3.1.2），不是業務拒絕
 * ——它不是「設計時就知道會發生」的事，使用者也無從修正。回一棵缺角的樹才是最糟的，
 * 因為它看起來完全正常。
 */
const assertNoCycle = (rows: readonly PermissionRow[], byId: ReadonlyMap<string, PermissionRow>): void => {
  // 已確認可達根節點的 id。沒有這層記憶，深樹會退化成 O(n²) 的重複往上走。
  const settled = new Set<string>()

  for (const row of rows) {
    const path = new Set<string>()
    let cursor: PermissionRow | undefined = row

    while (cursor !== undefined && !settled.has(cursor.id)) {
      if (path.has(cursor.id)) {
        throw new Error(`權限樹出現環路：節點 ${cursor.code}（${cursor.id}）的祖先鏈繞回自己`)
      }
      path.add(cursor.id)
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
    }

    for (const settledId of path) settled.add(settledId)
  }
}

/**
 * 扁平列 → 權限樹。
 *
 * @param rows 已由呼叫端過濾過的權限列（軟刪除與停用的節點不應出現在這裡）。
 * @returns 依 `sortOrder`、`code` 排序的根節點清單；輸入為空時回空陣列（§3.1.3 查詢類）。
 * @throws 資料出現環路時拋出，屬系統錯誤路徑（§3.1.2）。
 *
 * **父節點不在輸入集合內的列一律視為根節點，而不是丟掉。** 這種情況會發生在
 * 「分類節點被停用、底下的端點節點仍啟用」的時候。丟掉的話，那些權限會從設定頁上消失，
 * 而管理員看不出它們還存在、也還授得出去——一個看不見的權限比一個位置怪異的權限危險得多。
 */
export const buildPermissionTree = (rows: readonly PermissionRow[]): readonly PermissionNode[] => {
  const byId = new Map<string, PermissionRow>(rows.map((row) => [row.id, row]))
  assertNoCycle(rows, byId)

  const childrenByParentId = new Map<string, PermissionRow[]>()
  const roots: PermissionRow[] = []

  for (const row of rows) {
    const parent = row.parentId === null ? undefined : byId.get(row.parentId)
    if (parent === undefined) {
      roots.push(row)
      continue
    }
    const siblings = childrenByParentId.get(parent.id)
    if (siblings === undefined) childrenByParentId.set(parent.id, [row])
    else siblings.push(row)
  }

  // 環路已在上面排除，因此這段遞迴一定會終止。
  const toNode = (row: PermissionRow): PermissionNode => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isAssignable: row.isAssignable,
    sortOrder: row.sortOrder,
    children: [...(childrenByParentId.get(row.id) ?? [])].sort(compareSiblings).map(toNode),
  })

  return [...roots].sort(compareSiblings).map(toNode)
}
