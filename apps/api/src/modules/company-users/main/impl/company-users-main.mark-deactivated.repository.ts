/**
 * 資料存取：停用一個公司帳號成員關係。
 *
 * 條件式 UPDATE ＋ 檢查影響列數（§4.4）：預期目前狀態是 `ACTIVE`。兩個離職請求同時對同一位
 * 員工辦理（理論上不該發生，因為離職本身已經被 `employee_employments` 的條件式 UPDATE 擋成
 * 只有一個成功），這裡的 0 列是第二道保險。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { CompanyUserStatus, companyUsers } from '../../../../db/schema/index.ts'

export const markCompanyUserDeactivated = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  deactivatedAt: string,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    companyUsers,
    { status: CompanyUserStatus.Inactive, deactivatedAt, updatedAt: deactivatedAt },
    eq(companyUsers.id, companyUserId),
    eq(companyUsers.status, CompanyUserStatus.Active),
  )

  return readAffectedRows(result)
}
