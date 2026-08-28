/**
 * `departments/main` 的純函式測試（§7.1）。
 *
 * 這些是**不需要資料庫**的規則：把扁平列表組成樹（多層、多根），以及「新的上層是不是自己的
 * 子孫」的成環判斷。端點測試（連 MariaDB）驗證的是「這些規則真的被 service 呼叫並回成業務
 * 錯誤」，本檔驗證的是規則本身算得對不對——兩者職責不同，因此分成兩支（比照
 * `shifts/main/__tests__/shifts-main-domain.test.ts` 的既有作法）。
 */
import { describe, expect, test } from 'bun:test'
import { buildDepartmentTree, wouldCreateCycle } from '../domain/department-tree.ts'
import type { DepartmentNode } from '../domain/department-model.ts'

const node = (
  overrides: Partial<DepartmentNode> & Pick<DepartmentNode, 'id' | 'parentId' | 'name'>,
): DepartmentNode => ({
  code: overrides.id,
  description: null,
  status: 'ACTIVE',
  ...overrides,
})

describe('buildDepartmentTree：多層、多根', () => {
  test('三層樹：總公司 → 業務處 → 業務一課，子節點依名稱（碼位）排序', () => {
    const nodes: readonly DepartmentNode[] = [
      node({ id: 'hq', parentId: null, name: '總公司' }),
      node({ id: 'sales', parentId: 'hq', name: '業務處' }),
      node({ id: 'sales-1', parentId: 'sales', name: '業務一課' }),
      node({ id: 'sales-2', parentId: 'sales', name: '業務二課' }),
    ]

    const tree = buildDepartmentTree(nodes)

    expect(tree).toHaveLength(1)
    expect(tree[0]?.id).toBe('hq')
    expect(tree[0]?.children).toHaveLength(1)
    expect(tree[0]?.children[0]?.id).toBe('sales')
    expect(tree[0]?.children[0]?.children.map((child) => child.id)).toEqual(['sales-1', 'sales-2'])
  })

  test('多根：兩個沒有上層的部門各自是一棵樹', () => {
    const nodes: readonly DepartmentNode[] = [
      node({ id: 'hq-a', parentId: null, name: 'A 集團總部' }),
      node({ id: 'hq-b', parentId: null, name: 'B 集團總部' }),
      node({ id: 'hq-a-1', parentId: 'hq-a', name: 'A 集團財務部' }),
    ]

    const tree = buildDepartmentTree(nodes)

    expect(tree.map((root) => root.id)).toEqual(['hq-a', 'hq-b'])
    expect(tree[0]?.children.map((child) => child.id)).toEqual(['hq-a-1'])
    expect(tree[1]?.children).toEqual([])
  })

  test('空清單回空陣列', () => {
    expect(buildDepartmentTree([])).toEqual([])
  })

  test('每個節點的欄位原樣帶出（description／status 不遺漏）', () => {
    const nodes: readonly DepartmentNode[] = [
      { id: 'hq', parentId: null, code: 'HQ', name: '總公司', description: '公司最高層級', status: 'INACTIVE' },
    ]

    const tree = buildDepartmentTree(nodes)

    expect(tree[0]).toEqual({
      id: 'hq',
      code: 'HQ',
      name: '總公司',
      description: '公司最高層級',
      status: 'INACTIVE',
      children: [],
    })
  })
})

describe('wouldCreateCycle：規則 1（不得成環）', () => {
  test('★ A → B → C，把 A 的上層改成 C，必須被擋', () => {
    const nodes: readonly DepartmentNode[] = [
      node({ id: 'a', parentId: null, name: 'A' }),
      node({ id: 'b', parentId: 'a', name: 'B' }),
      node({ id: 'c', parentId: 'b', name: 'C' }),
    ]

    // 現況：a 是根，b 的上層是 a，c 的上層是 b（A → B → C）。
    // 想把 a 的上層改成 c：c 沿著父節點鏈往上走會經過 b、再到 a，走得到 a 本身，是環。
    expect(wouldCreateCycle(nodes, 'a', 'c')).toBe(true)
  })

  test('★ 把自己設成自己的上層，必須被擋', () => {
    const nodes: readonly DepartmentNode[] = [node({ id: 'a', parentId: null, name: 'A' })]

    expect(wouldCreateCycle(nodes, 'a', 'a')).toBe(true)
  })

  test('把 C 的上層改成 A（往上搬，不是往下）：合法，不算成環', () => {
    const nodes: readonly DepartmentNode[] = [
      node({ id: 'a', parentId: null, name: 'A' }),
      node({ id: 'b', parentId: 'a', name: 'B' }),
      node({ id: 'c', parentId: 'b', name: 'C' }),
    ]

    // c 原本掛在 b 底下，改成直接掛在 a 底下：a 沒有任何祖先鏈會走到 c，合法。
    expect(wouldCreateCycle(nodes, 'c', 'a')).toBe(false)
  })

  test('把一個部門搬到完全不相干的另一棵樹底下：合法', () => {
    const nodes: readonly DepartmentNode[] = [
      node({ id: 'a', parentId: null, name: 'A' }),
      node({ id: 'b', parentId: 'a', name: 'B' }),
      node({ id: 'x', parentId: null, name: 'X' }),
    ]

    expect(wouldCreateCycle(nodes, 'b', 'x')).toBe(false)
  })

  test('候選上層不存在於清單中（例如已被刪除）：不視為成環，交由呼叫端的存在性檢查處理', () => {
    const nodes: readonly DepartmentNode[] = [node({ id: 'a', parentId: null, name: 'A' })]

    expect(wouldCreateCycle(nodes, 'a', 'not-a-real-id')).toBe(false)
  })
})
