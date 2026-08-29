/**
 * 業務動作：新增員工。
 *
 * 目前只寫一張表，但仍然收交易 handle（§4.4）：`employees` 很快就會與 `employee_employments`
 * （任職）一起建立，而「一次建立分散在多張表的關聯資料」只成功一半會留下
 * 「有員工卻沒有任何任職紀錄」這種永遠用不了、也沒人會發現的孤兒。
 *
 * **本檔不開交易**（計畫 §4.1）：`createEmployeeInTransaction` 只收外部交易 handle，
 * 開交易的包裝在入口檔 `employees-main.service.ts` 的 `createEmployee`——那支給單一端點用，
 * 自己開交易；這支給 Stage 4 的 `employees/onboarding` 編排點用，跟著呼叫端已經開好的交易走。
 * `impl/` 不該知道自己是不是交易的最外層（§4.4：交易邊界屬於 service 入口這一層）。
 *
 * **稽核與寫入同一交易**（稽核計畫 §5）：`recordAudit` 失敗會讓這個交易一起失敗，
 * 「員工建好了但沒有稽核」在稽核的語意下本來就是不該發生的事。`recordAudit` 收
 * `TransactionRunner`（`db/client.ts`），因此呼叫端傳裸連線池進來會是編譯錯誤，
 * 不必再靠 `check-audit-transaction.ts` 讀語法樹才擋得住。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { CreateEmployeeInput, EmployeeDetail } from '../domain/employee-model.ts'
import { employeeCodeDuplicated, employeeIdentityNumberDuplicated } from '../employees-main.errors.ts'
import { findEmployeeDetail, insertEmployee } from '../employees-main.repository.ts'

export const createEmployeeInTransaction = async (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: CreateEmployeeInput,
): Promise<ServiceResult<EmployeeDetail>> => {
  const now = context.clock.now()
  const employeeId = crypto.randomUUID()

  // 員工編號與身分證的唯一性都交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）：
  // 兩個併發請求會同時查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
  const outcome = await insertEmployee(tx, context.companyId, { id: employeeId, profile: input, now })

  // 重複時**立刻結束、不再對這個交易下任何一句寫入**（§3.4）：InnoDB 對唯一鍵違反只回滾
  // 那一句，交易本身仍然可用，但繼續寫下去就會出現孤兒列。這裡沒有後續寫入，帶著零筆變更結束。
  //
  // 只回一筆錯誤而不是把兩種重複一起回（§3.1.1 希望收集多筆）：資料庫一次只會回報一個
  // 唯一鍵違反，而另一條路（先查兩次再寫）被 §4.3 禁止。取捨與理由寫在
  // `domain/employee-duplicate.ts` 的 `classifyEmployeeDuplicate` 上。
  if (outcome === 'duplicate-code') return fail([employeeCodeDuplicated()])
  if (outcome === 'duplicate-identity-number') return fail([employeeIdentityNumberDuplicated()])

  // 新增事件：before 為 null（稽核計畫 §4.2）。`input` 已經是 `EmployeeProfileInput` 的形狀
  // （不含 `id`），與政策的內層 key 定義域逐字對應，不必再另外裁切。
  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employees.main.create',
    subjectTable: 'employees',
    subjectId: employeeId,
    changes: buildAuditChanges('employees', null, input),
    effectiveDate: null,
    now,
  })

  const detail = await findEmployeeDetail(tx, context.companyId, employeeId)
  if (detail === null) {
    // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的員工讀不回來，代表資料庫或本模組的
    // 公司範圍有問題，不是使用者做錯了什麼。走例外路徑才會帶著堆疊進告警。
    // 訊息只帶 id，不帶任何個資（§5.1：例外訊息禁止包含完整身分證等敏感值）。
    throw new Error(`員工 ${employeeId} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}
