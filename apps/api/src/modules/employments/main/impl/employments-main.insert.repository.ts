/**
 * 資料存取：新增任職。
 *
 * **同日重複由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）——與 `departments` 的
 * `insertDepartment` 同一個理由。真正的重疊防線是呼叫端在同一交易內已經做過的
 * `FOR UPDATE` 鎖 ＋ `overlapsAnyPeriod` 檢查，這裡的唯一鍵只是最後一道保險。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { EmploymentStatus, employeeEmployments, type EmploymentTypeCodeValue } from '../../../../db/schema/index.ts'
import { isDuplicateEmploymentHireDate, type EmploymentInsertOutcome } from '../domain/employment-duplicate.ts'

export type NewEmployment = {
  readonly id: string
  readonly employeeId: string
  readonly employmentTypeCode: EmploymentTypeCodeValue
  readonly employmentNatureCode: number | null
  readonly hireDate: string
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertEmployment = async (
  runner: QueryRunner,
  companyId: string,
  employment: NewEmployment,
): Promise<EmploymentInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(employeeEmployments, (scopedCompanyId) => ({
      id: employment.id,
      companyId: scopedCompanyId,
      employeeId: employment.employeeId,
      employmentTypeCode: employment.employmentTypeCode,
      employmentNatureCode: employment.employmentNatureCode,
      hireDate: employment.hireDate,
      leaveDate: null,
      lastWorkingDate: null,
      leaveReasonCode: null,
      status: EmploymentStatus.Active,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: employment.now,
      updatedAt: employment.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateEmploymentHireDate(error)) return 'duplicate-hire-date'
    // 其餘一律是系統錯誤（§3.1.2），含複合外鍵違反：原樣重拋。
    throw error
  }
}
