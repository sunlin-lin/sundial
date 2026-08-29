/**
 * 業務動作：刪除員工（軟刪除）。
 *
 * **本次沒有做「仍有任職紀錄／出勤資料就不可刪除」這類前置檢查**，理由是那些表
 * （`employee_employments`、出勤、薪資）都還沒建立——現在寫出來的檢查只會是在查一張空表，
 * 看起來有擋、實際上永遠通過，而那比沒有更糟：日後那些表落地時，沒有人會知道這裡有一段
 * 一直在回 false 的檢查需要重新確認。相依模組落地時應在此補上（已寫進交付回報）。
 *
 * 稽核走與 `create`／`update` 相同的形狀（稽核計畫 §4.2）：刪除事件的 `after` 為 `null`，
 * `before` 是刪除前的明文快照——用的是與 `update` 同一支 `findEmployeeAuditSnapshot`。
 *
 * **本檔不開交易**：只收外部交易 handle，開交易的包裝在入口檔（見 `impl/
 * employees-main.create.service.ts` 檔頭同一段說明，理由逐字適用）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { EmployeesMainContext } from '../domain/employee-context.ts'
import type { DeletedEmployee, EmployeeTargetInput } from '../domain/employee-model.ts'
import { employeeNotFound, employeeStateChanged } from '../employees-main.errors.ts'
import { findEmployeeAuditSnapshot, markEmployeeDeleted } from '../employees-main.repository.ts'

export const deleteEmployeeInTransaction = async (
  tx: TransactionRunner,
  context: EmployeesMainContext,
  input: EmployeeTargetInput,
): Promise<ServiceResult<DeletedEmployee>> => {
  const now = context.clock.now()
  // 軟刪除時同時寫入非零的 `deleted_seq`（§4.3）：UNIQUE 索引中 NULL 互不相等，
  // 只寫 `deleted_at` 的話「未刪除資料的員工編號與身分證唯一」等於沒擋。
  // 用刪除當下的 epoch 毫秒，同一位員工只會被刪除一次，因此不可能與自己碰撞。
  const deletedSeq = context.clock.epochMs()

  // 存在性檢查與稽核的 before 快照合併成同一次查詢，理由同 `update` 切片。
  const before = await findEmployeeAuditSnapshot(tx, context.companyId, input.id)
  // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
  if (before === null) return fail([employeeNotFound()])

  // 條件式 UPDATE ＋ 檢查影響列數（§4.4）：兩個使用者同時按刪除時，第二筆影響 0 列。
  // 少了這道檢查，第二個人會拿到一個成功的回應，而他其實什麼也沒做。
  const affectedRows = await markEmployeeDeleted(tx, context.companyId, input.id, { now, deletedSeq })
  if (affectedRows === 0) return fail([employeeStateChanged()])

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'employees.main.delete',
    subjectTable: 'employees',
    subjectId: input.id,
    changes: buildAuditChanges('employees', before, null),
    effectiveDate: null,
    now,
  })

  return succeed({ id: input.id })
}
