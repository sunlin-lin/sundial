/**
 * 資料存取：啟用一個公司帳號成員關係。與 `mark-deactivated.repository.ts` 對稱。
 *
 * 條件式 UPDATE ＋ 檢查影響列數（§4.4）：預期目前狀態是 `INACTIVE`。呼叫端
 * （`impl/company-users-main.activate-account.service.ts`）已經先讀過一次目前狀態決定要不要
 * 呼叫這支函式，這裡的 0 列是併發下的第二道保險（例如兩個管理者同時對同一個帳號按下啟用）。
 *
 * **`deactivated_at` 清成 `null`**：這一欄與 `activated_at` 都只記「最近一次」的時間點，不是歷史
 * 清單（單一欄位本來就存不下歷史），因此重新啟用之後，「上次被停用的時間」不再是目前狀態的一部分
 * ——比照新增公司成員時 `deactivated_at` 一開始就是 `null`（`insert-company-user.repository.ts`）。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import { CompanyUserStatus, companyUsers } from '../../../../db/schema/index.ts'

export const markCompanyUserActivated = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
  activatedAt: string,
): Promise<number> => {
  const tenant = new TenantDatabase(runner, companyId)

  const result = await tenant.update(
    companyUsers,
    { status: CompanyUserStatus.Active, activatedAt, deactivatedAt: null, updatedAt: activatedAt },
    eq(companyUsers.id, companyUserId),
    eq(companyUsers.status, CompanyUserStatus.Inactive),
  )

  return readAffectedRows(result)
}
