/**
 * 資料存取動作：登入成功後才查的顯示用資料（姓名、公司代號與名稱）。
 *
 * **與身分解析查詢刻意分成兩支**，即使它們的資料只差一次 join。理由是 §4.2 的第 3 項邊界：
 * 身分解析查詢**不得回傳任何業務欄位**——只要它能回傳姓名或公司名稱，它就是一個
 * 不帶公司條件的萬用查詢。分開之後，這一支是**帶公司條件的普通業務查詢**，
 * 而且它只在密碼驗證通過之後才會被呼叫：登入失敗的路徑碰不到任何業務資料。
 *
 * 顯式 `select` ＋ `join`（§4.6）。
 */
import { and, eq } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { companies, companyUsers, employees, users } from '../../../../db/schema/index.ts'
import type { SessionProfile } from '../domain/session-model.ts'

/**
 * @returns 查不到公司或成員時回 `null`。呼叫端（登入 service）會把它當成系統錯誤——
 *   身分才剛剛在同一次請求裡解析成功，這裡就查不到，代表資料庫或本模組的公司範圍有問題，
 *   不是使用者做錯了什麼（§3.1.2）。
 */
export const findSessionProfile = async (
  runner: QueryRunner,
  companyId: string,
  companyUserId: string,
): Promise<SessionProfile | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  // `companies` 不在 `CompanyScopedTable` 內（見 `db/schema/index.ts`）：它是 Tenant 根節點，
  // `id` 就是公司範圍本身，交給 `TenantDatabase` 會變成「用 company_id 過濾 company_id 表」。
  // 因此這一支走裸 runner，而條件正是公司範圍本身。
  const companyRows = await runner
    .select({ companyCode: companies.companyCode, name: companies.name })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.deletedSeq, 0)))
    .limit(1)

  const company = companyRows[0]
  if (company === undefined) return null

  const memberRows = await tenant
    .selectFrom({ username: users.username, employeeName: employees.name }, companyUsers)
    .innerJoin(users, eq(users.id, companyUsers.userId))
    // **員工的公司條件寫在 `ON` 而不是 `WHERE`**：寫進 `WHERE` 會讓這個 LEFT JOIN 在語意上退化成
    // INNER JOIN——沒有綁員工的成員（外部協作者）會整列被濾掉，於是他們登入時查不到 profile，
    // 而症狀是「某些帳號登入回系統錯誤」。比對的是 `employees.company_id = company_users.company_id`
    //（欄對欄），而 `company_users.company_id` 已經被下方的 `scopeAll` 釘死成本次的公司範圍，
    // 因此 §4.2「join 的每一張帶 company_id 的表都要帶條件」仍然成立。
    .leftJoin(
      employees,
      and(
        eq(employees.id, companyUsers.employeeId),
        eq(employees.companyId, companyUsers.companyId),
        eq(employees.deletedSeq, 0),
      ),
    )
    .where(tenant.scopeAll([companyUsers], eq(companyUsers.id, companyUserId)))
    .limit(1)

  const member = memberRows[0]
  if (member === undefined) return null

  return {
    // 沒有綁員工的成員（外部協作者）以帳號當顯示名稱：回空字串會讓畫面右上角變成一片空白，
    // 而使用者無從判斷是「沒有名字」還是「載入失敗」。
    displayName: member.employeeName ?? member.username,
    companyCode: company.companyCode,
    companyName: company.name,
  }
}
