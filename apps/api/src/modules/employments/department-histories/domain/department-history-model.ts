/**
 * 部門歷史的業務型別。本目錄一律零 IO（§0.1、§3.1.1）。
 */

/** 單筆部門歷史的完整內容。 */
export type DepartmentHistoryDetail = {
  readonly id: string
  readonly employmentId: string
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type DepartmentHistoryListPage = {
  readonly items: readonly DepartmentHistoryDetail[]
  readonly totalCount: number
}

/**
 * 列表查詢條件。**`employmentId` 必填，不是選填**：部門歷史依字典是「任職期間的部門歸屬歷史」，
 * 沒有「查全公司部門歷史」這個使用情境（那要問的問題是「哪個部門現在有哪些人」，字典明說那由
 * `employee_department_histories` 計算但不落在這張表上——見 `departments` 模組的 `hasChildren`
 * 檢查註解），因此本查詢一律要求呼叫端指定任職。
 */
export type DepartmentHistoryListQuery = {
  readonly employmentId: string
  readonly perPage: number
  readonly currentPage: number
}

/**
 * 新增部門歷史。**沒有對外端點**（Stage 3 只交付查詢端點，見計畫回報），但保留為業務動作
 * ——供內部測試（§7.3 併發測試）與 Stage 4 的 `employees/onboarding` 編排點未來呼叫
 * （§0.4：「沒有端點的業務動作一樣放入口檔」）。
 */
export type CreateDepartmentHistoryInput = {
  readonly employmentId: string
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/**
 * 稽核用快照（`AUDIT_FIELD_POLICY.employee_department_histories` 的 `source`）。
 * 型別收斂到 `string | null`，結構相容於 `AuditSnapshot`。
 */
export type DepartmentHistoryAuditSnapshot = {
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}
