/**
 * 資料存取：依員工找出他的公司帳號成員關係，**不限狀態**。
 *
 * 與 `find-active-by-employee.repository.ts` 的差別只有一條 `WHERE`：那一支只給離職流程用
 * （只關心「現在還有沒有一個生效中的帳號可以停用」），這一支給啟用／停用兩個端點的業務層用——
 * 兩者都需要先看到**目前狀態**才能判斷「已經是目標狀態了，這次是空操作」還是「操作者想動的
 * 剛好是自己的帳號」，這兩個判斷都得在寫入之前完成，因此不能重用只回傳 `ACTIVE` 那一支。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUsers, type CompanyUserStatusValue } from '../../../../db/schema/index.ts'

/**
 * @returns 查無此員工的公司帳號時回 `null`——**包含「屬於別家公司」**（§3.2、§4.2）：`company_id`
 *   由 `TenantDatabase` 補上，別家公司的資料在查詢階段就等同於不存在。
 */
export const findCompanyUserByEmployee = async (
  runner: QueryRunner,
  companyId: string,
  employeeId: string,
): Promise<{ readonly id: string; readonly status: CompanyUserStatusValue } | null> => {
  const rows = await new TenantDatabase(runner, companyId)
    .select({ id: companyUsers.id, status: companyUsers.status }, companyUsers, eq(companyUsers.employeeId, employeeId))
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { id: row.id, status: row.status }
}
