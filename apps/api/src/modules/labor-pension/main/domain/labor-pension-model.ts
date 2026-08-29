/**
 * 勞退自願提繳率設定的業務型別。本目錄一律零 IO（§0.1、§3.1.1）。
 * 形狀與 `withholding/main/domain/withholding-model.ts` 同構，差別只在多一個 `createdBy`
 * （資料字典：「設定者公司成員 ID」，`employee_withholding_settings` 沒有這一欄）。
 */

export type LaborPensionSettingDetail = {
  readonly id: string
  readonly employeeId: string
  /** 自願提繳率，例如 `'0.0600'`。decimal 一律字串（§4.7），不轉 number。 */
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type LaborPensionSettingListPage = {
  readonly items: readonly LaborPensionSettingDetail[]
  readonly totalCount: number
}

/** 列表查詢條件。`employeeId` 必填——理由與 `WithholdingSettingListQuery` 同構。 */
export type LaborPensionSettingListQuery = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

export type CreateLaborPensionSettingInput = {
  readonly employeeId: string
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/** 稽核用快照（`AUDIT_FIELD_POLICY.employee_labor_pension_settings` 的 `source`）。 */
export type LaborPensionSettingAuditSnapshot = {
  readonly voluntaryContributionRate: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}
