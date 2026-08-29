/**
 * 資料存取：依 id 取單一任職的完整內容。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeEmployments } from '../../../../db/schema/index.ts'
import type { EmploymentDetail } from '../domain/employment-model.ts'

/**
 * @returns 查無資料回 `null`。**別家公司的任職也回 `null`**，走同一行程式碼（§3.2、§4.2）。
 *   已軟刪除的任職同樣視為不存在。
 */
export const findEmploymentDetail = async (
  runner: QueryRunner,
  companyId: string,
  employmentId: string,
): Promise<EmploymentDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant.select(
    {
      id: employeeEmployments.id,
      employeeId: employeeEmployments.employeeId,
      employmentTypeCode: employeeEmployments.employmentTypeCode,
      employmentNatureCode: employeeEmployments.employmentNatureCode,
      hireDate: employeeEmployments.hireDate,
      leaveDate: employeeEmployments.leaveDate,
      lastWorkingDate: employeeEmployments.lastWorkingDate,
      leaveReasonCode: employeeEmployments.leaveReasonCode,
      status: employeeEmployments.status,
      createdAt: employeeEmployments.createdAt,
      updatedAt: employeeEmployments.updatedAt,
    },
    employeeEmployments,
    eq(employeeEmployments.id, employmentId),
    eq(employeeEmployments.deletedSeq, 0),
    isNull(employeeEmployments.deletedAt),
  )

  return row ?? null
}
