/**
 * 資料存取：由呼叫者的 `company_user` 身分，解出「自己」是哪個員工、哪筆任職。
 *
 * ## 為什麼這兩支查詢必須在交易**之外**執行（`create` 用）
 *
 * 計畫 §4.5：打卡交易內第一句固定是 `SELECT ... FOR UPDATE` 鎖定 `employee_employments`
 * 那一列，理由是 MariaDB 預設 `REPEATABLE READ`，一致性讀快照在交易內**第一次**執行一般
 * `SELECT` 時就固定；先做任何一般 `SELECT`，快照就會在鎖到手之前提前建立，之後鎖到手才做的
 * 配對查詢會讀到鎖定前的舊快照，兩個交易一樣會同時判定「沒有衝突」而雙雙寫入成功。
 *
 * `findActiveEmploymentIdForOperator` 是一般 `SELECT`（查「這位操作者目前有效任職是哪一筆」），
 * 若把它放進打卡交易內部，就會是那個交易的第一句一般查詢，搶先建立快照——即使後面緊接著就是
 * `FOR UPDATE`。因此呼叫端（`impl/attendance-records.create.service.ts`）必須在**開交易之前**、
 * 用 `context.db`（連線池，不是 `tx`）呼叫這支函式解出 `employmentId`，取得之後才開交易、
 * 用該 `employmentId` 對 `employee_employments` 做 `FOR UPDATE`（見
 * `attendance-records.find-employment-for-update.repository.ts`）。這支函式用的是連線池借出的
 * **另一條連線**，與稍後開啟的交易互不共享快照，因此不會污染交易的第一句規則。
 *
 * 若在交易開始之後、`FOR UPDATE` 之前呼叫這支函式，會回到 §4.5 要防的那個坑——這是本檔存在的
 * 唯一理由：把「解出 employmentId」與「鎖 employmentId」拆成兩支函式、兩個呼叫時機，
 * 而不是寫成一支「用 employeeId 直接鎖」的函式省掉這一步，是因為鎖定當下必須知道鎖哪一列
 * （`employee_employments.id`），而 `employee_id → employment_id` 這個對應關係本身就需要一次
 * 查詢才知道。
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

/**
 * 由 `company_user` 一次查出「自己」目前有效的員工與任職 id。**一般 `SELECT`，只能在打卡交易
 * 開始之前呼叫**——見檔頭。找不到連結員工，或員工目前沒有有效任職，都回 `null`。
 */
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
