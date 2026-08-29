/**
 * 職稱主檔的業務型別（service ↔ repository 之間傳遞的形狀）。本目錄一律零 IO（§0.1、§3.1.1）。
 */
export type { JobTitleStatusValue } from '../../../../db/schema/index.ts'

import type { JobTitleStatusValue } from '../../../../db/schema/index.ts'

/** 單筆職稱。列表與 `get` 共用同一個形狀——職稱沒有像員工那樣「清單頁不需要的重欄位」。 */
export type JobTitleDetail = {
  readonly id: string
  /** `true` 代表系統預設（`company_id IS NULL`），公司不能修改或刪除（見 repository 層）。 */
  readonly isSystem: boolean
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobTitleStatusValue
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。 */
export type JobTitleListPage = {
  readonly items: readonly JobTitleDetail[]
  readonly totalCount: number
}

/**
 * 列表查詢條件。
 *
 * `keyword` 比對 `code`／`name`：兩者都是明文欄位，不像員工編號那樣要顧慮加密欄位無法 LIKE。
 */
export type JobTitleListQuery = {
  readonly keyword: string | null
  readonly perPage: number
  readonly currentPage: number
}

/**
 * 新增職稱。**沒有 `status`**：比照 `departments` 的 `CreateDepartmentInput`，建立時一律
 * `JobTitleStatus.Active`，不收使用者輸入。**也沒有 `companyId`／`isSystem`**：本模組的建立端點
 * 只服務「新增公司自訂職稱」，`companyId` 一律是呼叫端已驗證的公司範圍，`isSystem` 一律 `false`
 * （見 `db/schema/job-titles.ts` 檔頭）。
 */
export type CreateJobTitleInput = {
  readonly code: string
  readonly name: string
  readonly description: string | null
}

/** 修改職稱，含啟用／停用（比照 `departments` 的 `status` 併入 `update`，不另開端點）。 */
export type UpdateJobTitleInput = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: JobTitleStatusValue
}

/** 只帶識別碼的動作輸入（`get`／`delete`）。 */
export type JobTitleTargetInput = {
  readonly id: string
}

/** `delete` 的回傳。只回 `id`：刪掉之後沒有「變更後的完整資源」可回。 */
export type DeletedJobTitle = {
  readonly id: string
}
