/**
 * 職稱歷史的業務型別。本目錄一律零 IO（§0.1、§3.1.1）。形狀與 `department-histories/domain/
 * department-history-model.ts` 完全同構——「同一任職同一時間一筆有效職稱」與「同一任職同一時間
 * 一筆有效部門」是同一種鎖粒度（計畫 §4.3），差別只在指向 `job_titles` 而不是 `departments`。
 */

export type JobTitleHistoryDetail = {
  readonly id: string
  readonly employmentId: string
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type JobTitleHistoryListPage = {
  readonly items: readonly JobTitleHistoryDetail[]
  readonly totalCount: number
}

/** 列表查詢條件。`employmentId` 必填，理由與 `DepartmentHistoryListQuery` 同構。 */
export type JobTitleHistoryListQuery = {
  readonly employmentId: string
  readonly perPage: number
  readonly currentPage: number
}

/** 新增職稱歷史。**有對外端點**（與部門歷史 Stage 3 的「本輪不開端點」不同）：Stage 5 要求
 * 「兩張歷史表的查詢與異動」，本表因此開了 `create`（見 routes 檔）。
 */
export type CreateJobTitleHistoryInput = {
  readonly employmentId: string
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/** 稽核用快照（`AUDIT_FIELD_POLICY.employee_job_title_histories` 的 `source`）。 */
export type JobTitleHistoryAuditSnapshot = {
  readonly jobTitleId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}
