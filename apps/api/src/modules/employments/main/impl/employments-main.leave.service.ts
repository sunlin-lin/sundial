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
 * 兩筆稽核（任職異動、帳號停用）都在同一個交易、同一個檔案裡呼叫 `recordAudit`：
 * 理由與 `impl/employments-main.create.service.ts` 檔頭對 `check:audit-transaction` 的說明相同
 * ——那支檢查要求 `.transaction(...)` 與 `recordAudit(` 同檔同回呼，因此交易邊界開在這一層。
 *
 * **不做的事，寫下來避免日後被「順手」補上**：不驗證 `leave_date`／`last_working_date` 是否為
 * 未來日期、不檢查是否已經超過到職日——資料字典只明文要求「三欄同時必填」與「`last_working_date
 * ≤ leave_date`」，本檔只做這兩件事。
 */
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

export const leaveEmployment = async (
  context: EmploymentsMainContext,
  input: LeaveEmploymentInput,
): Promise<ServiceResult<EmploymentDetail>> => {
  const now = context.clock.now()

  return context.db.transaction(async (tx): Promise<ServiceResult<EmploymentDetail>> => {
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
        changes: buildAuditChanges('company_users', { status: 'ACTIVE' }, { status: 'INACTIVE' }),
        effectiveDate: null,
        now,
      })
    }

    const updated = await findEmploymentDetail(tx, context.companyId, input.id)
    if (updated === null) {
      throw new Error(`任職 ${input.id} 辦理離職後於同一交易內讀不回來`)
    }
    return succeed(updated)
  })
}
