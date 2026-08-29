/**
 * 資料存取：更新員工的基本資料與個資。
 *
 * **這裡「有」檢查影響列數，與 `roles` 的同名切片刻意相反。** roles 不檢查，是因為
 * MySQL 回的 `affectedRows` 是**實際變更的列數**：使用者按了儲存卻沒改任何欄位時那個數字是 0，
 * 拿它當併發衝突的依據會把正常操作誤報成「資料已被別人改過」。
 *
 * 本表在「四個加密欄位皆有提供」時沒有這個問題，而且原因是結構性的：加密欄位每次寫入都用
 * **新的隨機 IV**（GCM 的正確用法），因此即使使用者一個字都沒改，被 `SET` 到的加密欄位位元組
 * 也必然不同——只要那一列還在、還符合條件，`affectedRows` 就一定 ≥ 1。
 *
 * **省略＝不變更（見 `EmployeeProfileUpdateInput` 檔頭）之後，這個保證不再無條件成立。**
 * `toEncryptedColumnsForUpdate` 只把「有送」的加密欄位放進 `SET`，省略的欄位完全不觸碰
 * ——不會被覆寫，當然也不會產生新的 IV。因此 `affectedRows = 0` 現在有兩種可能：
 *
 * 1. 在讀取與寫入之間，這筆資料被別人刪掉或改掉了（原本唯一的含義，仍然是主要情境）；
 * 2. **一次真正意義上「什麼都沒改」的送出**：`employeeCode`／`name`／`gender` 與資料庫現值
 *    逐字相同，四個加密欄位又全部省略，`updated_at` 也剛好落在同一秒（DATETIME 只有秒級精度，
 *    同一秒內的第二次請求並不罕見）。這種送出目前會被歸類成 `not-affected`（呼叫端會回
 *    `employees.main.errors.state-changed`），與「真的被別人改過」共用同一個錯誤碼。
 *
 * 第 2 種是刻意接受的落差，不是遺漏：它不會造成資料損毀或遺失更新（沒有任何一欄真的被覆寫），
 * 使用者看到的只是一個泛用的「請重新整理再試」訊息，而正常前端在送出前本來就會做 dirty-check
 * （沒有變更就不送出這次請求），因此這個分支預期極少被真的打中。要完全避免它，唯一的辦法是
 * 引入一個不受「省略即不變更」影響的樂觀鎖欄位（例如毫秒級版本號），那是比這次修復大得多的
 * 變更，不在本次範圍內。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { readAffectedRows } from '../../../../db/driver-result.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
import { classifyEmployeeDuplicate, type EmployeeWriteOutcome } from '../domain/employee-duplicate.ts'
import type { EmployeeProfileUpdateInput } from '../domain/employee-model.ts'
import { toEncryptedColumnsForUpdate } from '../domain/employee-secrets.ts'

export type EmployeeProfileUpdate = {
  readonly profile: EmployeeProfileUpdateInput
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
  // 只含「有送」的加密欄位（§ 檔頭）：省略的欄位不會出現在這個物件的 key 裡，
  // 下面 `...encrypted` 展開進 SET 子句時，那些欄位自然不會被觸碰。
  const encrypted = toEncryptedColumnsForUpdate(cipher, update.profile)

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
