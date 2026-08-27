/**
 * 資料存取：單一員工的完整內容（已遮罩）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
import type { EmployeeDetail } from '../domain/employee-model.ts'
import { toMaskedDetail } from '../domain/employee-secrets.ts'

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

  return row === undefined ? null : toMaskedDetail(cipher, row)
}
