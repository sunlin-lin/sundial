/**
 * 成員角色清單的排序白名單（§1.4）。
 *
 * 放在 `domain/` 而不是 routes 或 repository，是因為兩邊都要用它、而兩邊互相 import 都不合適：
 * routes 需要它產生 request schema 的聯集字面值，repository 需要它對應到實際欄位。
 * 白名單一旦有兩份，「schema 允許排序、SQL 卻沒對應欄位」這種錯就會在執行期才炸開。
 *
 * 為什麼一定要白名單：把排序欄位字串直接接進 SQL 等於開放 SQL injection 與全表掃描（§1.4）。
 */

/** 允許排序的欄位，用 API 對外的 camelCase 名稱，不是 DB 欄位名。 */
export const ASSIGNMENT_SORT_FIELDS = ['assignedAt', 'roleCode', 'roleName', 'revokedAt'] as const

export type AssignmentSortField = (typeof ASSIGNMENT_SORT_FIELDS)[number]

export type AssignmentSort = {
  readonly field: AssignmentSortField
  readonly order: 'asc' | 'desc'
}

/**
 * 未指定排序時的預設值。
 *
 * 用「最近指派的排前面」而不是建立順序：這個清單的用途是「這位成員現在有哪些角色、是誰給的」，
 * 最近一次異動永遠是使用者最想先看到的那一筆。
 */
export const DEFAULT_ASSIGNMENT_SORT: AssignmentSort = { field: 'assignedAt', order: 'desc' }
