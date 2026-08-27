/**
 * 業務動作：修改員工。
 *
 * 與 `roles` 不同，**員工編號是可以改的**（資料字典：「可修改，修改前後須留稽核紀錄」），
 * 只是不得與同公司其他員工重複——那條由 `uq_employees_company_code` 擋（§4.3）。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { EmployeeDetail, UpdateEmployeeInput } from '../domain/employee-model.ts'
import {
  employeeCodeDuplicated,
  employeeIdentityNumberDuplicated,
  employeeNotFound,
  employeeStateChanged,
} from '../employees-main.errors.ts'
import { findEmployeeDetail, updateEmployeeProfile } from '../employees-main.repository.ts'

export const updateEmployee = async (
  context: EmployeesMainContext,
  input: UpdateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<EmployeeDetail>> => {
    const current = await findEmployeeDetail(tx, context.cipher, context.companyId, input.id)
    // 動作類端點的「目標不存在」是業務錯誤（§3.1.3）：使用者確實嘗試了一個做不到的操作。
    // 回 200 等於告訴前端「改好了」，畫面會若無其事地更新成完成後的狀態。
    // **別家公司的員工也走這一行**，回一模一樣的錯誤（§3.2）。
    if (current === null) return fail([employeeNotFound()])

    // ────────────────────────────────────────────────────────────────────────────
    // TODO(稽核表定案後補；後端規範 §9 第 2 項「稽核日誌表名與逐欄定義尚未定案」):
    //   資料字典 `02-employee-payroll-cost.md` 第 37 行要求「員工編號修改前後值寫入系統稽核」，
    //   §5.3 也要求個資異動必須寫稽核、且必須與業務資料**在同一交易內**。
    //
    //   **本次沒有做，而且刻意不自建稽核表。** 理由：稽核表一旦建起來就會被寫入資料，
    //   而 §5.3 規定稽核紀錄只能新增、禁止修改與刪除——猜錯欄位的代價不是改個 schema，
    //   是一批**無法重寫也無法補齊**的紀錄。等到正式定案，那批紀錄要嘛缺欄位（爭議時舉不出證），
    //   要嘛得從兩張表拼起來（而拼接規則本身沒有人能保證正確）。少一段稽核是已知的缺口，
    //   多一張猜出來的稽核表是一個看起來已經完成、實際上不能用的東西。
    //
    //   定案後要在**這個交易內**補上的內容（§5.3 的最低要求）：
    //     操作者（context 目前沒有帶 companyUserId，屆時要一併加進 `EmployeesMainContext`）、
    //     操作時間（`now`）、操作類型、資料主體（`input.id`）、
    //     異動前後差異——**只記 `employee_code` 的前後值**：
    //       `current.employeeCode` → `input.employeeCode`。
    //     其餘個資欄位一律**不得**把明文寫進稽核（§5.1：log 與稽核禁止含完整身分證等敏感值），
    //     需要時只記「哪個欄位被改過」這個事實。
    // ────────────────────────────────────────────────────────────────────────────

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

    const updated = await findEmployeeDetail(tx, context.cipher, context.companyId, input.id)
    if (updated === null) {
      // 系統錯誤（§3.1.2）：同一交易內剛讀到、剛寫過的員工又讀不回來了。
      throw new Error(`員工 ${input.id} 更新後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
