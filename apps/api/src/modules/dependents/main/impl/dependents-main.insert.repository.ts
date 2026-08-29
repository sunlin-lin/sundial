/**
 * 資料存取：新增眷屬。唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」（§4.3）。
 * 身分證的重複現在直接由明文欄位上的唯一鍵擋（`uq_employee_dependents_company_employee_
 * identity_plain`，見 `domain/dependent-duplicate.ts`）。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { DependentStatus, employeeDependents } from '../../../../db/schema/index.ts'
import { classifyDependentDuplicate, type DependentInsertOutcome } from '../domain/dependent-duplicate.ts'
import type { DependentProfileInput } from '../domain/dependent-model.ts'
import { toStoredColumns } from '../domain/dependent-secrets.ts'

export type NewDependent = {
  readonly id: string
  readonly employeeId: string
  readonly profile: DependentProfileInput
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertDependent = async (
  runner: QueryRunner,
  companyId: string,
  dependent: NewDependent,
): Promise<DependentInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)
  const stored = toStoredColumns(dependent.profile)

  try {
    await tenant.insert(employeeDependents, (scopedCompanyId) => ({
      id: dependent.id,
      companyId: scopedCompanyId,
      employeeId: dependent.employeeId,
      name: dependent.profile.name,
      ...stored,
      relationshipCode: dependent.profile.relationshipCode,
      isStudent: dependent.profile.isStudent,
      isDisabled: dependent.profile.isDisabled,
      isUnableToWork: dependent.profile.isUnableToWork,
      isCohabiting: dependent.profile.isCohabiting,
      effectiveDate: dependent.profile.effectiveDate,
      endDate: null,
      status: DependentStatus.Active,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: dependent.now,
      updatedAt: dependent.now,
    }))
    return 'inserted'
  } catch (error) {
    const duplicate = classifyDependentDuplicate(error)
    if (duplicate !== null) return duplicate
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因。
    // 刻意不把 `error` 包進帶著明文的新訊息裡——例外訊息會進 log，而 §5.1 禁止明文進 log。
    throw error
  }
}
