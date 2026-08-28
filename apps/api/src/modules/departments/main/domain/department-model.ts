/**
 * 部門的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 這一組型別**刻意不等於 Drizzle 的 row，也不等於端點的 `data`**（§1.8.0 的三種形狀）：
 * 三者共用同一個型別時，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變
 * ——那是個資外洩最常見的路徑（§2）。部門沒有個資欄位，但這條規則不因此鬆動。
 *
 * 本目錄一律零 IO：這裡只有型別與純函式，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */

/**
 * 部門狀態，`'ACTIVE' | 'INACTIVE'` 的聯集字面值。
 *
 * **以 type-only import 沿用 `db/schema/departments.ts` 的定義**，不在這裡另抄一份：
 * 抄一份就是第二份真相，兩邊哪天不一致不會有任何地方變紅。type-only import 在編譯後完全消失，
 * 因此 domain 仍然不帶任何執行期相依（`verbatimModuleSyntax`）。
 */
export type { DepartmentStatusValue } from '../../../../db/schema/index.ts'

import type { DepartmentStatusValue } from '../../../../db/schema/index.ts'

/**
 * 部門樹的一個節點（扁平形式，來自資料庫，尚未組裝成樹）。
 *
 * `tree` 端點與 `update` 的成環檢查（`domain/department-tree.ts`）共用這一組欄位：前者拿去組裝
 * 樹狀結構，後者只讀 `id`／`parentId` 這兩欄去走父節點鏈——同一次查詢餵給兩種用途，
 * 不必為成環檢查另開一支只挑兩個欄位的查詢。
 */
export type DepartmentNode = {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: DepartmentStatusValue
}

/** 部門樹的一個節點（組裝後，遞迴形式）。`tree` 端點的 `data` 就是這個型別的陣列（根節點）。 */
export type DepartmentTreeNode = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: DepartmentStatusValue
  readonly children: readonly DepartmentTreeNode[]
}

/** 單一部門的完整內容。`get`／`create`／`update` 共用同一個形狀。 */
export type DepartmentDetail = DepartmentNode & {
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 建立部門。
 *
 * **沒有 `status`**：UI 定案「建立時由系統帶入…初始 status…，不要求使用者輸入系統欄位」
 * （`docs/ui/08-ui-organization-structure.md`），因此新部門一律以 `DepartmentStatus.Active` 建立，
 * request schema 裡根本沒有這個欄位——不是「收進來再驗算」而是「不收」，理由與 `shifts` 的推導值
 * 不收同一件事：收了就要處理「送進來的值該不該採用」這種情況，而任何處置都要有人決定一次。
 */
export type CreateDepartmentInput = {
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
}

/**
 * 修改部門，含改上層部門（搬移子樹）與啟用／停用。
 *
 * **搬移子樹（改 `parentId`）不改寫任何員工的部門歷史**（資料字典「定案：樹的四條規則」第 4 條，
 * 計畫 §5 第 4 點）：歷史記的是「那一天他在哪個部門」，部門自己搬家不改變那件事。本輪沒有
 * `employee_department_histories` 這張表，這裡沒有任何程式碼會「不小心」去改寫它——這段話留給
 * 那張表出現之後的人看：**加東西進來之前，先想清楚為什麼這裡本來什麼都沒有。**
 */
export type UpdateDepartmentInput = {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: DepartmentStatusValue
}

/** 只帶識別碼的動作輸入（`get`／`delete`）。 */
export type DepartmentTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedDepartment = {
  readonly id: string
}
