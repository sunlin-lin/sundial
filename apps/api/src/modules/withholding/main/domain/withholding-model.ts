/** 扣繳設定的業務型別。本目錄一律零 IO（§0.1、§3.1.1）。 */
export type { WithholdingMethodCodeValue } from '../../../../db/schema/index.ts'

import type { WithholdingMethodCodeValue } from '../../../../db/schema/index.ts'

export type WithholdingSettingDetail = {
  readonly id: string
  readonly employeeId: string
  readonly withholdingMethodCode: WithholdingMethodCodeValue
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type WithholdingSettingListPage = {
  readonly items: readonly WithholdingSettingDetail[]
  readonly totalCount: number
}

/** 列表查詢條件。`employeeId` 必填——扣繳設定以員工為單位，字典沒有「查全公司」的使用情境。 */
export type WithholdingSettingListQuery = {
  readonly employeeId: string
  readonly perPage: number
  readonly currentPage: number
}

export type CreateWithholdingSettingInput = {
  readonly employeeId: string
  readonly withholdingMethodCode: WithholdingMethodCodeValue
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/** 稽核用快照（`AUDIT_FIELD_POLICY.employee_withholding_settings` 的 `source`）。 */
export type WithholdingSettingAuditSnapshot = {
  readonly withholdingMethodCode: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}
