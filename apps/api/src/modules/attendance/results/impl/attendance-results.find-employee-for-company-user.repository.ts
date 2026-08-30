/**
 * 資料存取：由呼叫者的 `company_user` 身分，解出「自己」是哪個員工——`list-own` 需要它才能把
 * 查詢範圍限定在 token 推出的本人（計畫 §5 Stage 7）。
 *
 * **這是刻意複製，不是跨次目錄 import**：`attendance/records` 已經有一支逐字相同的
 * `findEmployeeIdForCompanyUser`（`impl/attendance-records.find-operator-employment.
 * repository.ts`），但它只在 `attendance-records.repository.ts`（repository 入口）匯出，沒有
 * 在 `attendance-records.service.ts`（service 入口）re-export——`sundial-backend` skill
 * module-layout §3「同一大目錄內的次目錄之間可以互相 import，但 `*.repository.ts` 不得被本次
 * 目錄以外的任何檔案 import」，因此 `results` 這個次目錄不能直接拿 `records` 的 repository。
 * 依 skill §4.2「兩者都成立才複製」的判準：這是一段純粹「company_user_id → employee_id」的單表
 * `SELECT`，不含任何業務規則（不會分岔）；也不足以構成「升格成 records 的業務動作」（沒有
 * `results` 以外的第三方需要它，升格只會讓 records 的入口多一個與撤銷／打卡無關的動作）。
 * 因此依 skill 指引就地複製一份，不強行共用。
 */
import { eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUsers } from '../../../../db/schema/index.ts'

/** 由 `company_user` 查出他連結的員工 id；沒有連結員工（純協作者帳號）回 `null`。 */
export const findEmployeeIdForCompanyUser = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<string | null> => {
  const tenant = new TenantDatabase(runner, companyId)
  const rows = await tenant.select(
    { employeeId: companyUsers.employeeId },
    companyUsers,
    eq(companyUsers.id, companyUserId),
  )
  const row = rows[0]
  return row?.employeeId ?? null
}
