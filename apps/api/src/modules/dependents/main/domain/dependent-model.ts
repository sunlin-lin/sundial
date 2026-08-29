/**
 * 眷屬的業務型別（service ↔ repository 之間傳遞的形狀）。本目錄一律零 IO（§0.1、§3.1.1）。
 *
 * **輸出型別上沒有明文身分證／生日**，理由與 `employees/main/domain/employee-model.ts` 檔頭
 * 「最重要的一條」同構：{@link DependentDetail} 帶的是 `xxxMasked`，明文只出現在**寫入方向**的
 * {@link DependentProfileInput}。
 */
export type { DependentRelationshipCodeValue, DependentStatusValue } from '../../../../db/schema/index.ts'

import type { DependentRelationshipCodeValue, DependentStatusValue } from '../../../../db/schema/index.ts'

/** 單筆眷屬的完整內容。`create`／`list` 共用同一個形狀。敏感欄位一律已遮罩。 */
export type DependentDetail = {
  readonly id: string
  readonly employeeId: string
  readonly name: string
  /** 已遮罩的身分證（僅末 3 碼，§5.1）。 */
  readonly identityNumberMasked: string
  /** 已遮罩的出生年月日（`YYYY-**-**`，§5.1）。 */
  readonly birthdayMasked: string
  readonly relationshipCode: DependentRelationshipCodeValue
  readonly isStudent: boolean
  readonly isDisabled: boolean
  readonly isUnableToWork: boolean
  readonly isCohabiting: boolean
  readonly effectiveDate: string
  readonly endDate: string | null
  readonly status: DependentStatusValue
  readonly createdAt: string
  readonly updatedAt: string
}

/** 列表查詢的一頁結果。**不含總頁數**（§1.4）。 */
export type DependentListPage = {
  readonly items: readonly DependentDetail[]
  readonly totalCount: number
}

/** 列表查詢條件。`employeeId` 必填——眷屬以員工為單位，字典沒有「查全公司」的使用情境。 */
export type DependentListQuery = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

/**
 * 眷屬的個資與資格欄位，**全量、帶明文**。
 *
 * **這是建立用的輸入形狀，也是稽核前後快照的形狀**（`AUDIT_FIELD_POLICY.employee_dependents.source`
 * 逐字指到 {@link DependentAuditSnapshot}，本型別是它的子集），理由與 `employees` 的
 * `EmployeeProfileInput` 同構。
 *
 * **沒有 `employeeId`**：稽核記的是「這筆眷屬的可變欄位」，`employeeId` 是識別這筆眷屬屬於誰、
 * 不是「被改動的欄位」——與 `employments/main/domain/employment-model.ts` 的
 * `EmploymentAuditSnapshot` 排除 `employeeId`是同一個理由。
 */
export type DependentProfileInput = {
  readonly name: string
  /** 身分證字號。寫入前由 `shared/identity-normalization.ts` 的 `normalizeIdentityNumber` 正規化。 */
  readonly identityNumber: string
  /** 出生年月日 `YYYY-MM-DD`，台北的日曆日，不帶時區標記（§6.1）。 */
  readonly birthday: string
  readonly relationshipCode: DependentRelationshipCodeValue
  readonly isStudent: boolean
  readonly isDisabled: boolean
  readonly isUnableToWork: boolean
  readonly isCohabiting: boolean
  /** 開始列入扶養日期。 */
  readonly effectiveDate: string
}

export type CreateDependentInput = { readonly employeeId: string } & DependentProfileInput

/** 終止扶養（UI 定案 `docs/ui/20-employee-list.md` §3.4：「終止」）。獨立動作，不是 `update`。 */
export type TerminateDependentInput = {
  readonly id: string
  readonly endDate: string
}

/**
 * 稽核用快照（`AUDIT_FIELD_POLICY.employee_dependents` 的 `source`）。
 *
 * **獨立型別，涵蓋 `create`／`terminate` 兩個動作各自會用到的全部欄位**——與
 * `employments/main/domain/employment-model.ts` 的 `EmploymentAuditSnapshot`（同時涵蓋
 * `create`／`leave`）同一種形狀。`create` 時 `endDate` 恆為 `null`、`status` 恆為 `ACTIVE`；
 * `terminate` 只改動 `endDate`／`status`，其餘欄位原樣帶入 `before`／`after` 兩側（見
 * `impl/dependents-main.terminate.service.ts`）。
 */
export type DependentAuditSnapshot = {
  readonly name: string
  readonly identityNumber: string
  readonly birthday: string
  readonly relationshipCode: number
  readonly isStudent: boolean
  readonly isDisabled: boolean
  readonly isUnableToWork: boolean
  readonly isCohabiting: boolean
  readonly effectiveDate: string
  readonly endDate: string | null
  readonly status: string
}
