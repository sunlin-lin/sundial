/**
 * 部門樹的兩個純函式（零 IO，§1.4／§3.1.1）：把扁平列表組成樹、判斷「新的上層是不是自己的子孫」。
 *
 * **這兩件事資料庫都擋不住**（資料字典「定案：樹的四條規則」、計畫 §5）：
 * - 複合外鍵 `(company_id, parent_id) → departments(company_id, id)` 只管「上層存在且同公司」，
 *   不管「上層是不是自己的後代」——外鍵語意上完全沒有「祖先／子孫」這種東西可以表達。
 * - MariaDB 沒有遞迴查詢以外的樹狀原生支援，「整棵樹長什麼樣」必須在應用層組裝。
 *
 * 因此本檔的兩個函式是這兩條規則**唯一**的執行處：
 * - `wouldCreateCycle`：`update` 改 `parentId` 前必須呼叫，是則拒絕（`shifts-main.errors.ts`
 *   同類寫法：業務規則，不是例外）。
 * - `buildDepartmentTree`：`tree` 端點的唯一組裝邏輯。
 */
import type { DepartmentNode, DepartmentTreeNode } from './department-model.ts'

/**
 * 把扁平的部門列表組成樹（多層、多根）。
 *
 * **子節點依名稱排序，不是排序欄位**（資料字典「定案」表：「排序欄位不做，樹狀按名稱排」）。
 * **排序用碼位比較（`<`／`>`），不是 `localeCompare`**：`localeCompare` 的結果取決於執行環境的
 * ICU 版本與語系設定，同一份程式碼在不同機器上可能排出不同順序——這正是
 * `app/endpoint-inventory.ts` 的 `byCodePoint` 已經指出過的同一個坑（該檔的排序理由逐字適用
 * 於這裡）。中文名稱的碼位順序不等於筆畫或拼音順序，但這是可預期、可重現的犧牲；
 * `localeCompare` 換來的「看起來比較合理」是不可預期、不可重現的，而後者的失敗模式更難查
 * ——「這台機器上排序是對的，那台不是」。
 *
 * **不做防環的防禦性深度限制**：能不能出現環，由 `wouldCreateCycle` 在寫入 `update` 之前
 * 唯一把關；`create` 不可能製造環（新 id 一定沒有子孫）。只要那個守門有效，這裡收到的資料
 * 就不可能是一個環，遞迴組裝不會無限跑。
 */
export const buildDepartmentTree = (nodes: readonly DepartmentNode[]): readonly DepartmentTreeNode[] => {
  const childrenByParent = new Map<string | null, DepartmentNode[]>()
  for (const node of nodes) {
    const bucket = childrenByParent.get(node.parentId)
    if (bucket === undefined) {
      childrenByParent.set(node.parentId, [node])
    } else {
      bucket.push(node)
    }
  }

  const byNameCodePoint = (left: DepartmentNode, right: DepartmentNode): number => {
    if (left.name < right.name) return -1
    return left.name > right.name ? 1 : 0
  }

  const build = (parentId: string | null): readonly DepartmentTreeNode[] =>
    (childrenByParent.get(parentId) ?? []).toSorted(byNameCodePoint).map((node) => ({
      id: node.id,
      code: node.code,
      name: node.name,
      description: node.description,
      status: node.status,
      children: build(node.id),
    }))

  return build(null)
}

/**
 * 把 `movingId` 的上層改成 `newParentId` 會不會成環。
 *
 * **判法是從 `newParentId` 沿著父節點鏈往上走，看會不會走到 `movingId`。** 走得到就代表
 * `newParentId` 是 `movingId` 的子孫（或就是 `movingId` 自己）——把它設成自己的上層，
 * 等於把自己接到自己的子孫底下，任何遞迴查詢（包含 `buildDepartmentTree`）都會無限跑。
 *
 * 這個方向（從候選上層往上走）比反過來（從 `movingId` 往下窮舉整棵子樹）簡單：只需要一份
 * `id → parentId` 的對照表與一次線性走訪，不需要先把 `movingId` 底下的子孫全部收集起來。
 *
 * **`movingId === newParentId` 是這個判法的degenerate case，不需要另外特判**：走訪的第一步
 * `current = newParentId` 就等於 `movingId`，迴圈的第一次比較當場成立——「把自己設成自己的
 * 上層」與「把自己設成自己的子孫的子孫」是同一條規則抓到的兩種情況，不是兩條規則。
 *
 * @param nodes 該公司**全部**未刪除部門的 `id`／`parentId`（`domain/department-model.ts` 的
 *   `DepartmentNode`，這裡只用到這兩欄）。呼叫端必須傳入同一次交易內查到的完整列表——
 *   漏了某一段父節點鏈，走訪會提早在 `undefined` 處停下，把一個真正的環誤判成安全。
 * @param movingId 正在被搬移（改上層）的部門 id。
 * @param newParentId 想要設成的新上層 id。呼叫端已保證非 `null`——搬到根一律安全，不需要呼叫本函式。
 */
export const wouldCreateCycle = (
  nodes: readonly Pick<DepartmentNode, 'id' | 'parentId'>[],
  movingId: string,
  newParentId: string,
): boolean => {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]))

  let current: string | null = newParentId
  // 步數上限＝節點總數：正常的樹裡，父節點鏈的長度不會超過節點總數。這是防禦性上限，不是業務
  // 邏輯——資料裡本來就不該有環（見檔頭），但如果因為某個未預期的資料問題已經有環，寧可保守地
  // 判定「會成環」而中止走訪，也不要讓這個純函式自己陷入無窮迴圈。
  for (let steps = 0; current !== null; steps += 1) {
    if (current === movingId) return true
    if (steps >= nodes.length) return true
    current = parentOf.get(current) ?? null
  }
  return false
}
