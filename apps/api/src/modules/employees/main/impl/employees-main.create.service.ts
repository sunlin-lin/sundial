/**
 * 業務動作：新增員工。
 *
 * 目前只寫一張表，但仍然包在交易裡（§4.4）：`employees` 很快就會與 `employee_employments`
 * （任職）一起建立，而「一次建立分散在多張表的關聯資料」只成功一半會留下
 * 「有員工卻沒有任何任職紀錄」這種永遠用不了、也沒人會發現的孤兒。交易邊界屬於 service 層，
 * 現在就放對位置，比日後補上時再回頭把三支切片重排便宜。
 */
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { CreateEmployeeInput, EmployeeDetail } from '../domain/employee-model.ts'
import { employeeCodeDuplicated, employeeIdentityNumberDuplicated } from '../employees-main.errors.ts'
import { findEmployeeDetail, insertEmployee } from '../employees-main.repository.ts'

export const createEmployee = async (
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => {
  const now = context.clock.now()
  const employeeId = crypto.randomUUID()

  return context.db.transaction(async (tx): Promise<ServiceResult<EmployeeDetail>> => {
    // 員工編號與身分證的唯一性都交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）：
    // 兩個併發請求會同時查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
    const outcome = await insertEmployee(tx, context.cipher, context.companyId, { id: employeeId, profile: input, now })

    // 重複時**立刻結束、不再對這個交易下任何一句寫入**（§3.4）：InnoDB 對唯一鍵違反只回滾
    // 那一句，交易本身仍然可用，但繼續寫下去就會出現孤兒列。這裡沒有後續寫入，帶著零筆變更結束。
    //
    // 只回一筆錯誤而不是把兩種重複一起回（§3.1.1 希望收集多筆）：資料庫一次只會回報一個
    // 唯一鍵違反，而另一條路（先查兩次再寫）被 §4.3 禁止。取捨與理由寫在
    // `domain/employee-duplicate.ts` 的 `classifyEmployeeDuplicate` 上。
    if (outcome === 'duplicate-code') return fail([employeeCodeDuplicated()])
    if (outcome === 'duplicate-identity-number') return fail([employeeIdentityNumberDuplicated()])

    const detail = await findEmployeeDetail(tx, context.cipher, context.companyId, employeeId)
    if (detail === null) {
      // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的員工讀不回來，代表資料庫或本模組的
      // 公司範圍有問題，不是使用者做錯了什麼。走例外路徑才會帶著堆疊進告警。
      // 訊息只帶 id，不帶任何個資（§5.1：例外訊息禁止包含完整身分證等敏感值）。
      throw new Error(`員工 ${employeeId} 建立後於同一交易內讀不回來`)
    }
    return succeed(detail)
  })
}
