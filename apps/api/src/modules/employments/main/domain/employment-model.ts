/**
 * 任職的業務型別（service ↔ repository 之間傳遞的形狀）。
 *
 * 本表沒有個資欄位（`employee_id` 是識別碼，不是個資本身），因此不需要 `employees` 那一套
 * 遮罩／明文分流（§5.1 只管個資），輸出型別可以直接對應資料庫欄位，理由與 `departments` 相同。
 *
 * 本目錄一律零 IO：這裡只有型別與純函式，沒有任何資料庫或 http 相依（§0.1、§3.1.1）。
 */
export type { EmploymentStatusValue, EmploymentTypeCodeValue } from '../../../../db/schema/index.ts'

import type { EmploymentStatusValue, EmploymentTypeCodeValue } from '../../../../db/schema/index.ts'

/** 單筆任職的完整內容。`create`／`get`／`leave` 共用同一個形狀。 */
export type EmploymentDetail = {
  readonly id: string
  readonly employeeId: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode: number | null
  readonly hireDate: string
  readonly leaveDate: string | null
  readonly lastWorkingDate: string | null
  readonly leaveReasonCode: number | null
  readonly status: EmploymentStatusValue
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。**不含總頁數**（§1.4）。 */
export type EmploymentListPage = {
  readonly items: readonly EmploymentDetail[]
  readonly totalCount: number
}

export type EmploymentSortOption = {
  readonly field: string
  readonly order: 'asc' | 'desc'
}

/**
 * 列表查詢條件。
 *
 * `employeeId` 用 `null` 表示「不限員工」（查整間公司），與 `EmployeeListQuery.keyword` 的
 * 「`null` 表示沒有這個條件」是同一種表示法（§1.8.0）。
 */
export type EmploymentListQuery = {
  readonly employeeId: string | null
  readonly perPage: number
  readonly currentPage: number
  readonly sort: EmploymentSortOption
}

/**
 * 建立任職。
 *
 * **沒有 `status`**：新任職一律以 {@link EmploymentStatus.Active}（`db/schema/employee-
 * employments.ts`）建立，不開放呼叫端指定——理由與 `departments` 的 `CreateDepartmentInput`
 * 同構（UI 定案由系統帶入，不要求使用者輸入系統欄位）。
 *
 * **沒有離職三欄**：離職是獨立的業務動作（計畫 §7），不透過 `create` 或 `update` 表達。
 */
export type CreateEmploymentInput = {
  readonly employeeId: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode: number | null
  readonly hireDate: string
}

/** 只帶識別碼的動作輸入（`get`）。 */
export type EmploymentTargetInput = {
  readonly id: string
}

/**
 * 稽核用快照（`modules/audit/main/domain/audit-field-policy.ts` 的 `employee_employments` 政策
 * `source` 指向本型別）。**刻意是獨立型別，不是 `EmploymentDetail` 去掉 `id`／`employeeId`**：
 * 稽核記的是「這筆任職的可變欄位」，`employeeId` 是識別這筆任職屬於誰、不是「被改動的欄位」
 * ——混進去的話，`buildAuditChanges` 會把它當成一個永遠不會變的欄位收進政策，多一個不會用到的
 * key。所有欄位型別收斂到 `string | number | null`（`AuditFieldValue` 的定義域），
 * 才能結構相容於 `AuditSnapshot`（`modules/audit/main/domain/audit-change-set.ts`）。
 */
export type EmploymentAuditSnapshot = {
  readonly employmentTypeCode: number
  readonly employmentNatureCode: number | null
  readonly hireDate: string
  readonly leaveDate: string | null
  readonly lastWorkingDate: string | null
  readonly leaveReasonCode: number | null
  readonly status: string
}

/**
 * 辦理離職（計畫 §7）。
 *
 * 三欄同時必填（型別上用 `string`／`number` 而不是 `string | null`，把「三缺一」這個規則從
 * 「service 層要記得檢查」搬到「schema 就收不進來」——但 request body 的 JSON schema 本身無法
 * 表達「三個選填欄位互相牽動」，因此 routes 層仍是選填，由 handler 轉型時做「三缺一即錯」的
 * 顯式檢查，見 `employments-main.handler.ts` 的 `toLeaveInput`）。
 */
export type LeaveEmploymentInput = {
  readonly id: string
  readonly leaveDate: string
  readonly lastWorkingDate: string
  readonly leaveReasonCode: number
}
