/**
 * 資料存取：更新員工的基本資料與個資。
 *
 * **這裡「有」檢查影響列數，與 `roles` 的同名切片刻意相反。** roles 不檢查，是因為
 * MySQL 回的 `affectedRows` 是**實際變更的列數**：使用者按了儲存卻沒改任何欄位時那個數字是 0，
 * 拿它當併發衝突的依據會把正常操作誤報成「資料已被別人改過」。
 *
 * 本表沒有這個問題，而且原因是結構性的：加密欄位每次寫入都用**新的隨機 IV**（GCM 的正確用法），
 * 因此即使使用者一個字都沒改，`identity_number_encrypted` 等五個欄位的位元組也必然不同
 * ——只要那一列還在、還符合條件，`affectedRows` 就一定 ≥ 1。於是「0 列」乾淨地只剩下一個含義：
 * **在讀取與寫入之間，這筆資料被別人刪掉或改掉了**（§4.4）。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
import { classifyEmployeeDuplicate, type EmployeeWriteOutcome } from '../domain/employee-duplicate.ts'
import type { EmployeeProfileInput } from '../domain/employee-model.ts'
import { toEncryptedColumns } from '../domain/employee-secrets.ts'

export type EmployeeProfileUpdate = {
  readonly profile: EmployeeProfileInput
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

/**
 * 更新一筆員工。
 *
 * @returns `written` 成功；`not-affected` 代表條件式 UPDATE 沒有命中（呼叫端必須轉成
 *   「狀態已變更」而不是當成成功，否則兩個使用者同時編輯，第二個人會看到一個成功的回應
 *   與一份其實不是他存下去的資料）；兩種 `duplicate-*` 由唯一鍵攔截而來。
 */
export const updateEmployeeProfile = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
  update: EmployeeProfileUpdate,
): Promise<EmployeeWriteOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)
  const encrypted = toEncryptedColumns(cipher, update.profile)

  try {
    const result = await tenant.update(
      employees,
      {
        employeeCode: update.profile.employeeCode,
        name: update.profile.name,
        gender: update.profile.gender,
        ...encrypted,
        updatedAt: update.now,
      },
      eq(employees.id, employeeId),
      // 條件式 UPDATE 的「預期目前狀態」：這筆必須還沒被刪除（§4.4、§4.3）。
      // 少了它，呼叫端讀到員工與這次寫入之間若有人把他刪了，資料會被寫回一筆已刪除的列上。
      eq(employees.deletedSeq, 0),
      isNull(employees.deletedAt),
    )

    return readAffectedRows(result) === 0 ? 'not-affected' : 'written'
  } catch (error) {
    const duplicate = classifyEmployeeDuplicate(error)
    if (duplicate !== null) return duplicate
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋。訊息不得帶明文（§5.1）。
    throw error
  }
}
