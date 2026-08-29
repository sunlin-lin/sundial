/**
 * 資料存取：單一員工的完整內容（已遮罩）。
 *
 * **含目前有效的登入帳號 id**（`EmployeeDetail.companyUserId`，UI 定案
 * `docs/ui/20-employee-list.md` §3.5）：`employees` 與 `company_users` 是一對多
 * （同一位員工歷史上可能有多筆帳號，例如停用後又重新開通），因此**不用 JOIN**
 * ——一對多的關聯若直接 JOIN，會讓這支「取單一員工」的查詢在帳號有多筆歷史時展開成多列，
 * 回應形狀就得從單一物件變成陣列，而那不是這支端點要的東西（只要「目前這一個」）。
 * 改用篩了 `status = ACTIVE` 的獨立查詢 ＋ `limit(1)`，只有查得到員工才會多送這一次查詢
 * ——查無員工（含跨公司）時直接回 `null`，不必為了一筆注定用不到的結果多打一次資料庫。
 * 這與 `impl/employees-main.list.repository.ts` 的 `findAccountStatusesByEmployeeIds`
 * （同一張表的批次查法）、`company-users/main` 既有的
 * `impl/company-users-main.find-active-by-employee.repository.ts`（同一段邏輯）同構。
 *
 * **直接查 `company_users` 表，不呼叫 `company-users` 模組的 service／repository**：依模組歸屬
 * 判準（輸出型別決定掛哪個模組），這裡的輸出是「這位員工的登入帳號 id」，屬於員工明細的一部分，
 * 留在 `employees/main` 自己的資料存取層——與 `list.repository.ts` 已經直接查
 * `companyUsers`／`departments`／`jobTitles` 三張別的模組的表是同一種先例，不是新的例外。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { CompanyUserStatus, companyUsers, employees } from '../../../../db/schema/index.ts'
import type { EmployeeDetail } from '../domain/employee-model.ts'
import { toMaskedDetail } from '../domain/employee-secrets.ts'

/** 這位員工目前有效（`ACTIVE`）的登入帳號 id，查無則為 `null`。見本檔檔頭。 */
const findActiveCompanyUserId = async (tenant: TenantDatabase, employeeId: string): Promise<string | null> => {
  const rows = await tenant
    .select(
      { id: companyUsers.id },
      companyUsers,
      eq(companyUsers.employeeId, employeeId),
      eq(companyUsers.status, CompanyUserStatus.Active),
    )
    .limit(1)

  const row = rows[0]
  return row === undefined ? null : row.id
}

/**
 * 依 id 取員工。
 *
 * @returns 查無資料回 `null`。**別家公司的員工也回 `null`**，而且走的是同一行程式碼
 *   ——公司條件由 `TenantDatabase` 寫進 `WHERE`（§4.2），因此「不存在」與「屬於其他公司」
 *   想寫出不一致的回應都寫不出來（§3.2）。
 *
 * 回傳的**每一個敏感欄位都已經遮罩**（§5.1）：明文在本函式內解密、當場遮罩，一步都不往上走。
 * 需要完整值的端點依 §5.1 必須「明確授權且必寫稽核」，屆時是一個**另外命名**的動作，
 * 不是把明文加回這個回傳型別。
 */
export const findEmployeeDetail = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
): Promise<EmployeeDetail | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  // 顯式列出欄位，不用 `select *`（§2）：資料表加一個欄位就自動流到上層，是個資外洩最常見的路徑。
  const [row] = await tenant.select(
    {
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      gender: employees.gender,
      identityNumberEncrypted: employees.identityNumberEncrypted,
      birthdayEncrypted: employees.birthdayEncrypted,
      phoneEncrypted: employees.phoneEncrypted,
      emailEncrypted: employees.emailEncrypted,
      addressEncrypted: employees.addressEncrypted,
      createdAt: employees.createdAt,
      updatedAt: employees.updatedAt,
    },
    employees,
    eq(employees.id, employeeId),
    // §4.3：軟刪除的員工等同不存在，否則刪掉的員工還能被讀出來繼續編輯。
    // 兩個欄位都比對，理由見 list 切片的 `buildConditions`。
    eq(employees.deletedSeq, 0),
    isNull(employees.deletedAt),
  )
  if (row === undefined) return null

  const companyUserId = await findActiveCompanyUserId(tenant, employeeId)
  return toMaskedDetail(cipher, row, companyUserId)
}
