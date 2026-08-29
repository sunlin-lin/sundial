/**
 * 資料存取：依 id 取一筆眷屬的原始列（未遮罩）。
 *
 * **唯一合法呼叫者是 `terminate` 的 service**（見 `domain/dependent-secrets.ts` 的
 * `toPlaintextSnapshot` 檔頭）：終止前要讀一筆明文快照當稽核的 `before`，且終止完成後要
 * 重新讀一次組出遮罩後的回應（`toMaskedDetail`）。一般查詢（`list`）不會呼叫這支，
 * 各自的 select 已經內建在自己的 repository 切片裡（§0.4：實作切片之間不得互相 import）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { employeeDependents } from '../../../../db/schema/index.ts'
import type { DependentRow } from '../domain/dependent-secrets.ts'

export const findDependentRow = async (
  runner: QueryRunner,
  companyId: string,
  dependentId: string,
): Promise<DependentRow | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant.select(
    {
      id: employeeDependents.id,
      employeeId: employeeDependents.employeeId,
      name: employeeDependents.name,
      identityNumber: employeeDependents.identityNumber,
      birthday: employeeDependents.birthday,
      relationshipCode: employeeDependents.relationshipCode,
      isStudent: employeeDependents.isStudent,
      isDisabled: employeeDependents.isDisabled,
      isUnableToWork: employeeDependents.isUnableToWork,
      isCohabiting: employeeDependents.isCohabiting,
      effectiveDate: employeeDependents.effectiveDate,
      endDate: employeeDependents.endDate,
      status: employeeDependents.status,
      createdAt: employeeDependents.createdAt,
      updatedAt: employeeDependents.updatedAt,
    },
    employeeDependents,
    eq(employeeDependents.id, dependentId),
    // §4.3：軟刪除的眷屬等同不存在。
    eq(employeeDependents.deletedSeq, 0),
    isNull(employeeDependents.deletedAt),
  )

  return row ?? null
}
