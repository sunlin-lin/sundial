/**
 * 角色主檔的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 這一組型別**刻意不等於 Drizzle 的 row，也不等於端點的 `data`**（§1.8.0 的三種形狀）：
 * 三者共用同一個型別時，資料表加一個欄位就會自動出現在 API 上，而且沒有任何一行程式碼會改變
 * ——那是個資外洩最常見的路徑（§2）。中間這層轉換是刻意的邊界，不是多餘的搬運。
 *
 * 本目錄一律零 IO：這裡只有型別與純函式，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */

/**
 * 角色狀態，`'ACTIVE' | 'INACTIVE'` 的聯集字面值。
 *
 * **以 type-only import 沿用 `db/schema/roles.ts` 的定義**，不在這裡另抄一份：
 * 抄一份就是第二份真相，兩邊哪天不一致不會有任何地方變紅。type-only import 在編譯後完全消失，
 * 因此 domain 仍然不帶任何執行期相依（`verbatimModuleSyntax`）。
 */
export type { RoleStatusValue } from '../../../../db/schema/index.ts'

import type { RoleStatusValue } from '../../../../db/schema/index.ts'

/** 列表單筆。刻意只有清單需要的欄位——清單頁不該把說明與權限一起撈出來（§4.5）。 */
export type RoleSummary = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly status: RoleStatusValue
  readonly isSystem: boolean
}

/** 單筆角色的完整內容。`get`／`create`／`update`／`activate`／`deactivate` 共用同一個形狀。 */
export type RoleDetail = RoleSummary & {
  readonly description: string | null
  /** 已授予本角色的可指派權限（已排除被刪除的權限，前端的權限樹一定找得到對應節點）。 */
  readonly permissionIds: readonly string[]
  /** 目前仍有效指派給幾位公司成員。刪除前的「是否仍被使用」判斷就靠它。 */
  readonly assignedUserCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。**不含總頁數**（§1.4）：兩個數字並存時前端沒有依據判斷該信哪一個。 */
export type RoleListPage = {
  readonly items: readonly RoleSummary[]
  readonly totalCount: number
}

/** 排序條件。`field` 是 API 對外欄位名（camelCase），不是資料庫欄位名。 */
export type RoleSortOption = {
  readonly field: string
  readonly order: 'asc' | 'desc'
}

/**
 * 列表查詢條件。
 *
 * `keyword`／`status` 用 `null` 而不是選填欄位表示「沒有這個條件」：
 * `exactOptionalPropertyTypes` 之下，「沒有這個欄位」與「欄位是 undefined」是兩件事，
 * 讓它在跨層傳遞時只有一種形狀，下游就不必為兩種寫法各寫一次判斷。
 */
export type RoleListQuery = {
  readonly keyword: string | null
  readonly status: RoleStatusValue | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: RoleSortOption
}

export type CreateRoleInput = {
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly permissionIds: readonly string[]
}

/**
 * 更新角色。
 *
 * **沒有 `code`**：角色代碼建立後不修改（`docs/ui/07-ui-role-permission.md`），
 * 而且它是權限設定與歷史紀錄辨識角色的依據——可改的話，舊的稽核紀錄會指向一個已經改名的東西。
 * **也沒有 `status`**：狀態變更只能走 `activate`／`deactivate` 端點（§1.2），
 * 表單可寫狀態等於讓客戶端跳過該轉移應有的前置檢查（例如「最後一個管理角色不可停用」）。
 */
export type UpdateRoleInput = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly permissionIds: readonly string[]
}

/** 只帶識別碼的動作輸入（`get`／`delete`／`activate`／`deactivate`）。 */
export type RoleTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedRole = {
  readonly id: string
}
