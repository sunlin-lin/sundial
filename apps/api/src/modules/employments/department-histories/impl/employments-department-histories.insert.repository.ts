/** 資料存取：新增部門歷史。理由與 `employments-main.insert.repository.ts` 同構。 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeDepartmentHistories } from '../../../../db/schema/index.ts'
import {
  isDuplicateDepartmentHistoryEffectiveFrom,
  type DepartmentHistoryInsertOutcome,
} from '../domain/department-history-duplicate.ts'

export type NewDepartmentHistory = {
  readonly id: string
  readonly employmentId: string
  readonly departmentId: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly now: string
}

export const insertDepartmentHistory = async (
  runner: QueryRunner,
  companyId: string,
  history: NewDepartmentHistory,
): Promise<DepartmentHistoryInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(employeeDepartmentHistories, (scopedCompanyId) => ({
      id: history.id,
      companyId: scopedCompanyId,
      employmentId: history.employmentId,
      departmentId: history.departmentId,
      effectiveFrom: history.effectiveFrom,
      effectiveTo: history.effectiveTo,
      createdAt: history.now,
      updatedAt: history.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateDepartmentHistoryEffectiveFrom(error)) return 'duplicate-effective-from'
    throw error
  }
}
