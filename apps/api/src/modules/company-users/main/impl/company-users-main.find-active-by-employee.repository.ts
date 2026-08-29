/**
 * 資料存取：依員工找出他目前有效（`ACTIVE`）的公司帳號成員關係。
 *
 * 唯一呼叫者是離職流程的帳號停用（`modules/employments/main/impl/employments-main.leave.
 * service.ts`）。**不用 `FOR UPDATE`**：呼叫端已經先鎖住 `employees` 那一列（離職走的是任職的
 * 條件式 UPDATE，不是這裡的期間重疊寫入），這裡的停用本身走條件式 UPDATE ＋ 影響列數檢查
 * （§4.4），不需要第二道鎖。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { CompanyUserStatus, companyUsers } from '../../../../db/schema/index.ts'

/**
 * @returns 查無有效帳號（員工從未建立帳號、或帳號已經是停用狀態）時回 `null`——這是合法的結果，
 *   不是錯誤：Stage 3 尚未建立「新增員工同時建立帳號」的編排（那是計畫 Stage 4），
 *   在那條線落地之前，一位員工完全可能沒有對應的 `company_users`。
 */
export const findActiveCompanyUserByEmployee = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string } | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .select(
      { id: companyUsers.id },
      companyUsers,
      eq(companyUsers.employeeId, employeeId),
      eq(companyUsers.status, CompanyUserStatus.Active),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id }
}
