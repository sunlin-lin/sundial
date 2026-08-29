/**
 * 業務動作：辦理離職（實作計畫 `plans/05-employee-onboarding.md` §7）。
 *
 * 離職是**獨立的業務動作，不是 `update`**——它同時動任職與帳號，而那是一個交易：
 *
 * 1. 條件式 UPDATE 任職三欄（`leave_date`／`last_working_date`／`leave_reason_code`）並把
 *    `status` 改成 `LEFT`（§4.4：`WHERE leave_date IS NULL` 保證離職不能被重複執行）。
 * 2. **同步停用該員工的 `company_users`，但不刪除帳號與角色歷史**——呼叫
 *    `company-users` 模組的 {@link deactivateCompanyUser}，並把**本交易自己的 `tx`** 傳過去
 *    （§4.1：那支動作收 handle 作為第一個參數，不自己開交易，因此可以安全地被納入這裡的交易）。
 *    找不到有效帳號時是合法的空操作（Stage 3 還沒有「新增員工同時建立帳號」的編排，見該動作
 *    檔頭），不影響離職本身成不成功。
 * 3. **離職不修改舊任職的到職日等欄位，回任是新增一筆**（計畫 §7）——本檔沒有、也不該有任何
 *    一行程式碼去碰 `hire_date`。
 *
 * 兩筆稽核（任職異動、帳號停用）都在同一個交易裡呼叫 `recordAudit`，`recordAudit` 收
 * `TransactionRunner`（`db/client.ts`），因此傳裸連線池進來是編譯錯誤——不必再靠
 * `check-audit-transaction.ts` 讀語法樹判斷「有沒有交易」（該腳本的職責變化見其檔頭）。
 *
 * **本檔不開交易**：`leaveEmploymentInTransaction` 只收外部交易 handle，開交易的包裝在入口檔
 * `employments-main.service.ts` 的 `leaveEmployment`。同一個 `tx` 也原樣傳給
 * `company-users` 模組的 {@link deactivateCompanyUser}（該動作本來就是「收 handle、不自己開
 * 交易」的形狀，計畫 §4.1）。
 *
 * **不做的事，寫下來避免日後被「順手」補上**：不驗證 `leave_date`／`last_working_date` 是否為
 * 未來日期、不檢查是否已經超過到職日——資料字典只明文要求「三欄同時必填」與「`last_working_date
 * ≤ leave_date`」，本檔只做這兩件事。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { deactivateCompanyUser } from '../../../company-users/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmploymentsMainContext } from '../domain/employment-context.ts'
import type { EmploymentAuditSnapshot, EmploymentDetail, LeaveEmploymentInput } from '../domain/employment-model.ts'
import {
  employmentAlreadyLeft,
  employmentLastWorkingDateAfterLeaveDate,
  employmentNotFound,
  employmentStateChanged,
} from '../employments-main.errors.ts'
import { findEmploymentDetail, markEmploymentLeft } from '../employments-main.repository.ts'
import { EmploymentStatus } from '../../../../db/schema/index.ts'

/**
 * 把作廢的 token id 陣列序列化成一個可進 `changes` 的字串。與
 * `sessions/main/impl/sessions-main.revoke-on-reuse.service.ts` 的同名函式邏輯完全相同，
 * 但不能直接 import 它——跨模組不得互相 import 對方 `impl/` 底下的內部檔案（§0.4），
 * 這裡就地重寫同一個小函式（理由與那一份檔頭「為什麼欄位是字串，不是陣列」一致）。
 */
const serializeTokenIds = (tokenIds: readonly string[]): string | null =>
  tokenIds.length === 0 ? null : JSON.stringify(tokenIds)

export const leaveEmploymentInTransaction = async (
  tx: TransactionRunner,
  context: EmploymentsMainContext,
  input: LeaveEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => {
  const now = context.clock.now()

  const before = await findEmploymentDetail(tx, context.companyId, input.id)
  if (before === null) return fail([employmentNotFound()])
  if (before.leaveDate !== null) return fail([employmentAlreadyLeft()])
  if (input.lastWorkingDate > input.leaveDate) return fail([employmentLastWorkingDateAfterLeaveDate()])

  const affectedRows = await markEmploymentLeft(tx, context.companyId, input.id, {
    leaveDate: input.leaveDate,
    lastWorkingDate: input.lastWorkingDate,
    leaveReasonCode: input.leaveReasonCode,
    now,
  })
  if (affectedRows === 0) return fail([employmentStateChanged()])

  const beforeSnapshot: EmploymentAuditSnapshot = {
    employmentTypeCode: before.employmentTypeCode,
    employmentNatureCode: before.employmentNatureCode,
    hireDate: before.hireDate,
    leaveDate: before.leaveDate,
    lastWorkingDate: before.lastWorkingDate,
    leaveReasonCode: before.leaveReasonCode,
    status: before.status,
  }
  const afterSnapshot: EmploymentAuditSnapshot = {
    employmentTypeCode: before.employmentTypeCode,
    employmentNatureCode: before.employmentNatureCode,
    hireDate: before.hireDate,
    leaveDate: input.leaveDate,
    lastWorkingDate: input.lastWorkingDate,
    leaveReasonCode: input.leaveReasonCode,
    status: EmploymentStatus.Left,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employments.main.leave',
    subjectTable: 'employee_employments',
    subjectId: input.id,
    changes: buildAuditChanges('employee_employments', beforeSnapshot, afterSnapshot),
    effectiveDate: input.leaveDate,
    now,
  })

  // 同步停用帳號（計畫 §7）。傳入本交易自己的 `tx`——見檔頭第 2 點。
  const deactivation = await deactivateCompanyUser(tx, context.companyId, before.employeeId, now)
  if (deactivation !== null) {
    await recordAudit(tx, {
      companyId: context.companyId,
      actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
      action: 'employments.main.leave',
      subjectTable: 'company_users',
      subjectId: deactivation.companyUserId,
      // `company_users` 政策的 `status` 欄位（§4.5：外層 key 是表名，內層是業務欄位名）——
      // 見 `modules/audit/main/domain/audit-field-policy.ts` 與
      // `modules/audit/main/domain/audit-company-users-content.ts` 對這一欄的新增說明。
      // `revokedTokenIds` 併進同一筆稽核，不另開一筆：這次停用同步作廢的 session 是這次
      // 停用的一部分，不是獨立事件（理由見 `company-users-main.deactivate.service.ts` 檔頭
      // 「作廢後的 token id 清單不在這裡記稽核」）。
      changes: buildAuditChanges(
        'company_users',
        { status: 'ACTIVE' },
        { status: 'INACTIVE', revokedTokenIds: serializeTokenIds(deactivation.revokedTokenIds) },
      ),
      effectiveDate: null,
      now,
    })
  }

  const updated = await findEmploymentDetail(tx, context.companyId, input.id)
  if (updated === null) {
    throw new Error(`任職 ${input.id} 辦理離職後於同一交易內讀不回來`)
  }
  return succeed(updated)
}
