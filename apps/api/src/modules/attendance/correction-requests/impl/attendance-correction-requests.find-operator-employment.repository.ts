/**
 * 資料存取：由呼叫者的 `company_user` 身分，解出「自己」是哪個員工、哪筆任職，以及查出他連結的
 * 員工 id。
 *
 * **這是刻意複製，不是跨次目錄 import**：`attendance/records` 已經有兩支邏輯相同的函式
 * （`findEmployeeIdForCompanyUser`／`findActiveEmploymentIdForOperator`，`impl/
 * attendance-records.find-operator-employment.repository.ts`），但它們只在 `attendance-records.
 * repository.ts`（repository 入口）匯出，沒有在 service 入口 re-export——`sundial-backend` skill
 * module-layout §3「`*.repository.ts` 不得被本次目錄以外的任何檔案 import」。理由與
 * `attendance/results` 複製同一支函式的判準相同（見 `attendance-results.
 * find-employee-for-company-user.repository.ts` 檔頭）：純粹的單表／兩表 `SELECT`，不含業務規則，
 * 也不足以構成「升格成 `records` 的業務動作」。
 *
 * **不需要 `FOR UPDATE`**：與 `attendance/records` 的 `create` 不同，補打卡申請的重複判定完全
 * 靠唯一鍵表達（`db/schema/attendance-correction-requests.ts` 檔頭），不需要鎖 `employee_
 * employments` 再讀「目前有效打卡」做配對——這裡單純是「解出操作者是誰」，沒有鎖粒度的問題。
 */
import { and, eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companyUsers, employeeEmployments, EmploymentStatus } from '../../../../db/schema/index.ts'

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

/** 由 `company_user` 一次查出「自己」目前有效的員工與任職 id。找不到連結員工，或員工目前沒有
 * 有效任職，都回 `null`。 */
export const findActiveEmploymentIdForOperator = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<{ readonly employeeId: string; readonly employmentId: string } | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const rows = await tenant
    .selectFrom({ employeeId: employeeEmployments.employeeId, employmentId: employeeEmployments.id }, companyUsers)
    .innerJoin(
      employeeEmployments,
      and(
        eq(employeeEmployments.employeeId, companyUsers.employeeId),
        eq(employeeEmployments.companyId, companyUsers.companyId),
      ),
    )
    .where(
      tenant.scopeAll(
        [companyUsers, employeeEmployments],
        eq(companyUsers.id, companyUserId),
        eq(employeeEmployments.status, EmploymentStatus.Active),
        eq(employeeEmployments.deletedSeq, 0),
        isNull(employeeEmployments.deletedAt),
      ),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : { employeeId: row.employeeId, employmentId: row.employmentId }
}
