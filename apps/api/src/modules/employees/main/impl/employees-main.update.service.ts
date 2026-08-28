/**
 * 業務動作：修改員工。
 *
 * 與 `roles` 不同，**員工編號是可以改的**（資料字典：「可修改，修改前後須留稽核紀錄」），
 * 只是不得與同公司其他員工重複——那條由 `uq_employees_company_code` 擋（§4.3）。
 *
 * **稽核的 before 快照必須是明文，不能拿 `findEmployeeDetail` 的遮罩結果去比**（稽核計畫
 * §4.4）：員工更新是全量提交，AES-256-GCM 每次寫入的 IV 都不同，拿密文或拿遮罩後的字串比對，
 * 只改一個電話號碼也會讓身分證被誤判成「變更了」，而且每一次更新都會發生。因此這裡改用
 * `findEmployeeAuditSnapshot`（明文）取代原本的 `findEmployeeDetail`（遮罩）作為存在性檢查——
 * 兩者的 `WHERE` 條件完全相同（同公司、未軟刪除），查詢語意不變，只是換一份不遮罩的映射。
 */
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import { normalizeIdentityNumber } from '../domain/employee-identity.ts'
import type { EmployeeDetail, EmployeeProfileInput, UpdateEmployeeInput } from '../domain/employee-model.ts'
import {
  employeeCodeDuplicated,
  employeeIdentityNumberDuplicated,
  employeeNotFound,
  employeeStateChanged,
} from '../employees-main.errors.ts'
import { findEmployeeAuditSnapshot, findEmployeeDetail, updateEmployeeProfile } from '../employees-main.repository.ts'

export const updateEmployee = async (
  context: EmployeesMainContext,
  input: UpdateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<EmployeeDetail>> => {
    // 同時做存在性檢查與稽核的 before 快照：兩者本來就要讀同一列，分兩次查只會多一趟往返，
    // 而且會有一瞬間的視窗讓兩次讀到的不是同一個版本。
    const before = await findEmployeeAuditSnapshot(tx, context.cipher, context.companyId, input.id)
    // 動作類端點的「目標不存在」是業務錯誤（§3.1.3）：使用者確實嘗試了一個做不到的操作。
    // 回 200 等於告訴前端「改好了」，畫面會若無其事地更新成完成後的狀態。
    // **別家公司的員工也走這一行**，回一模一樣的錯誤（§3.2）。
    if (before === null) return fail([employeeNotFound()])

    const outcome = await updateEmployeeProfile(tx, context.cipher, context.companyId, input.id, {
      profile: input,
      now,
    })

    // 重複的兩種結果各自對應一個錯誤碼；理由與只回一筆的取捨見 create 切片與
    // `domain/employee-duplicate.ts`。
    if (outcome === 'duplicate-code') return fail([employeeCodeDuplicated()])
    if (outcome === 'duplicate-identity-number') return fail([employeeIdentityNumberDuplicated()])
    // 條件式 UPDATE 影響 0 列：在上面那次讀取與這次寫入之間，別人已經把這筆刪掉了（§4.4）。
    // 加密欄位每次都用新的隨機 IV，因此「使用者什麼都沒改」不會落到這一支
    // （見 update-profile 切片的檔頭），0 列乾淨地只剩下併發衝突一種含義。
    if (outcome === 'not-affected') return fail([employeeStateChanged()])

    // after 快照只取 `EmployeeProfileInput` 的八個欄位（不含 `id`）——政策的內層 key 定義域就是
    // 這個型別，混進 `id` 會被判為未分類欄位而拋例外（稽核計畫 §4.5）。身分證額外正規化一次，
    // 理由是**實際寫進資料庫的就是正規化後的值**（`toEncryptedColumns` 對兩邊做同一件事，
    // 見 `domain/employee-secrets.ts`）：不正規化的話，同一個身分證只是大小寫不同就會被誤判成
    // 「變更了」，而 `identityNumber` 是 presence 級，這種誤判無法從 `changes` 裡分辨出來。
    const after: EmployeeProfileInput = {
      employeeCode: input.employeeCode,
      name: input.name,
      gender: input.gender,
      identityNumber: normalizeIdentityNumber(input.identityNumber),
      birthday: input.birthday,
      phone: input.phone,
      email: input.email,
      address: input.address,
    }

    await recordAudit(tx, {
      companyId: context.companyId,
      actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
      action: 'employees.main.update',
      subjectTable: 'employees',
      subjectId: input.id,
      changes: buildAuditChanges('employees', before, after),
      effectiveDate: null,
      now,
    })

    const updated = await findEmployeeDetail(tx, context.cipher, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛讀到、剛寫過的員工又讀不回來了。
      throw new Error(`員工 ${input.id} 更新後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
