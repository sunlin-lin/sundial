/**
 * `buildPermissionTree` 的純函式測試（§7.1）。
 *
 * 這裡測的是三個「不會有任何錯誤訊息」的失敗模式：同層順序不穩定、父節點被過濾掉時子節點消失、
 * 資料出現環路時整棵子樹憑空不見。三者在整合測試中都表現為「畫面上少了幾個權限」，
 * 而那個症狀不會有人聯想到組樹函式。
 *
 * 不需要資料庫：組樹是零 IO 的純函式，這正是它被抽進 `domain/` 的理由（§0.4）。
 */
import { describe, expect, test } from 'bun:test'
import { buildPermissionTree, type PermissionRow } from '../domain/permission-tree.ts'

const row = (overrides: Partial<PermissionRow> & { readonly id: string; readonly code: string }): PermissionRow => ({
  parentId: null,
  name: overrides.code,
  description: null,
  isAssignable: true,
  sortOrder: 0,
  ...overrides,
})

describe('buildPermissionTree', () => {
  test('空輸入回空陣列（查詢類端點的「沒有資料」是正常答案，不是錯誤）', () => {
    expect(buildPermissionTree([])).toEqual([])
  })

  test('依 parent_id 組成巢狀結構，並保留節點的可授權旗標', () => {
    const nodes = buildPermissionTree([
      row({ id: 'p1', code: 'roles', isAssignable: false }),
      row({ id: 'p2', parentId: 'p1', code: 'roles.main', isAssignable: false }),
      row({ id: 'p3', parentId: 'p2', code: 'roles.main.list' }),
    ])

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.code).toBe('roles')
    expect(nodes[0]?.isAssignable).toBe(false)
    expect(nodes[0]?.children[0]?.code).toBe('roles.main')
    expect(nodes[0]?.children[0]?.children[0]?.code).toBe('roles.main.list')
    expect(nodes[0]?.children[0]?.children[0]?.isAssignable).toBe(true)
  })

  test('同層先依 sort_order 排序', () => {
    const nodes = buildPermissionTree([
      row({ id: 'b', code: 'b', sortOrder: 20 }),
      row({ id: 'a', code: 'a', sortOrder: 10 }),
      row({ id: 'c', code: 'c', sortOrder: 15 }),
    ])

    expect(nodes.map((node) => node.code)).toEqual(['a', 'c', 'b'])
  })

  test('sort_order 相同時以 code 決勝，順序不受輸入順序影響', () => {
    const ascending = buildPermissionTree([row({ id: '1', code: 'a' }), row({ id: '2', code: 'b' })])
    const descending = buildPermissionTree([row({ id: '2', code: 'b' }), row({ id: '1', code: 'a' })])

    expect(ascending.map((node) => node.code)).toEqual(['a', 'b'])
    expect(descending.map((node) => node.code)).toEqual(['a', 'b'])
  })

  test('子節點同層也套用同一組排序規則', () => {
    const nodes = buildPermissionTree([
      row({ id: 'root', code: 'roles', isAssignable: false }),
      row({ id: 'x', parentId: 'root', code: 'roles.main.update', sortOrder: 40 }),
      row({ id: 'y', parentId: 'root', code: 'roles.main.list', sortOrder: 10 }),
    ])

    expect(nodes[0]?.children.map((node) => node.code)).toEqual(['roles.main.list', 'roles.main.update'])
  })

  test('父節點不在輸入集合內時，子節點升為根節點而不是被丟掉', () => {
    // 會發生在「分類節點被停用、底下的端點節點仍啟用」時。丟掉的話那個權限會從設定頁上消失，
    // 但它其實還存在、也還授得出去——看不見的權限比位置怪異的權限危險得多。
    const nodes = buildPermissionTree([row({ id: 'orphan', parentId: 'missing-parent', code: 'roles.main.list' })])

    expect(nodes.map((node) => node.code)).toEqual(['roles.main.list'])
  })

  test('偵測到環路時中止，不回傳一棵缺角的樹', () => {
    // 自關聯外鍵擋不住 A→B→A：它只要求 parent_id 對得到一列，不管那一列繞不繞回來。
    const rows = [row({ id: 'a', parentId: 'b', code: 'a' }), row({ id: 'b', parentId: 'a', code: 'b' })]

    expect(() => buildPermissionTree(rows)).toThrow(/環路/)
  })

  test('偵測到自我指向的環路', () => {
    expect(() => buildPermissionTree([row({ id: 'a', parentId: 'a', code: 'a' })])).toThrow(/環路/)
  })

  test('同一棵樹中有正常分支時，環路仍然會被偵測到', () => {
    const rows = [
      row({ id: 'root', code: 'roles', isAssignable: false }),
      row({ id: 'leaf', parentId: 'root', code: 'roles.main.list' }),
      row({ id: 'a', parentId: 'b', code: 'a' }),
      row({ id: 'b', parentId: 'a', code: 'b' }),
    ]

    expect(() => buildPermissionTree(rows)).toThrow(/環路/)
  })
})
