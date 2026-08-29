/**
 * 職務歷史的業務型別。本目錄一律零 IO（§0.1、§3.1.1）。
 *
 * **與 `job-title-histories`／`department-histories` 最大的結構差異：本模組的「新增」一次可以
 * 帶多個 `jobPositionId`，不是一次一筆。** 字典明文「同一任職可同時有多個有效職務」、UI 定案
 * §2.2／§3.3 都寫「職務可指派多個」／「一個或多個職務」，因此本模組把「指派一批職務」設計成
 * 一個原子的業務動作，而不是讓呼叫端在迴圈裡逐一呼叫單筆版本——後者在 `employees/onboarding`
 * 的編排點裡會是「迴圈裡有資料庫呼叫的 await」，違反 §4.5 的 N+1 規則（`check:n-plus-one`）；
 * 前者則是先蒐集全部職務 id，一次查完、一次鎖完、一次寫完，形狀與 `company-users/roles` 的
 * `assignRolesInTransaction`（一次指派多個角色）同構。
 */

/** 單筆職務歷史的完整內容。 */
export type JobPositionHistoryDetail = {
  readonly id: string
  readonly employmentId: string
  readonly jobPositionId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type JobPositionHistoryListPage = {
  readonly items: readonly JobPositionHistoryDetail[]
  readonly totalCount: number
}

/** 列表查詢條件。`employmentId` 必填，理由與 `JobTitleHistoryListQuery` 同構。 */
export type JobPositionHistoryListQuery = {
  readonly employmentId: string
  readonly perPage: number
  readonly currentPage: number
}

/**
 * 新增一批職務歷史，**同一個 `employmentId` 對應一或多個 `jobPositionId`，全部共用同一段有效期間**。
 *
 * 共用同一段期間是刻意的簡化，不是遺漏：兩個實際呼叫者——`employees/onboarding`（到職當天指派
 * 多個職務，全部從到職日生效）與「修改員工」的組織資料分頁（UI 定案 §3.3：「組織異動必須指定
 * 未來生效日」，講的是**一個**生效日，同一次異動裡部門、職稱、職務用同一個生效日）——都不需要
 * 「這一批職務裡，某幾個生效日不同」這種形狀。真的出現那種需求時，呼叫端分兩次呼叫本動作即可
 * （不同生效日本來就是兩個不同的異動事件，值得各自留一筆稽核，不該合併成一次呼叫）。
 *
 * `jobPositionIds` 至少一筆，由呼叫端（request schema 的 `minItems: 1`）保證。**允許重複值嗎？
 * 不特別擋**：同一個 id 出現兩次時，第二筆與第一筆的期間必然重疊（同一段 `effectiveFrom`／
 * `effectiveTo`），會被 §4.3 的重疊檢查自然拒絕，不需要另外寫一條「不得重複」的規則。
 */
export type CreateJobPositionHistoriesInput = {
  readonly employmentId: string
  readonly jobPositionIds: readonly string[]
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/**
 * 稽核用快照（`AUDIT_FIELD_POLICY.employee_job_position_histories` 的 `source`）。
 *
 * **主體是這一次的批次動作本身（`subjectId = employmentId`），不是逐筆歷史列**——與
 * `company-users.roles.create` 一次指派多個角色只留一筆稽核是同一個判斷（理由見
 * `impl/employments-job-position-histories.create.service.ts` 檔頭）：一次指派五個職務，
 * 稽核要回答的是「這次異動指派了哪些職務、從什麼時候生效」，不該看起來像五個各自獨立的事件。
 * `jobPositionIds` 序列化成字串的理由與 `company-users/roles` 的 `serializeRoleIds` 相同
 * （`AuditFieldValue` 不允許陣列，見 `serializeJobPositionIds` 檔頭）。
 */
export type JobPositionAssignmentAuditSnapshot = {
  readonly jobPositionIds: string | null
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}
