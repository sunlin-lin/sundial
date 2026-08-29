/**
 * 業務動作：終止扶養（UI 定案 `docs/ui/20-employee-list.md` §3.4：「終止」）。
 *
 * 獨立業務動作，不是 `update`：與 `employments-main.leave.service.ts` 同一種形狀——
 * 條件式 UPDATE 既有列的 `end_date`／`status`，不是新增一筆（理由見 `db/schema/
 * employee-dependents.ts` 檔頭「終止」的說明）。
 *
 * **本檔不開交易**：`terminateDependentInTransaction` 只收外部交易 handle，開交易的包裝在
 * 入口檔 `dependents-main.service.ts` 的 `terminateDependent`。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { DependentStatus } from '../../../../db/schema/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DependentsMainContext } from '../domain/dependent-context.ts'
import type { DependentAuditSnapshot, DependentDetail, TerminateDependentInput } from '../domain/dependent-model.ts'
import { toPlaintextSnapshot, toMaskedDetail } from '../domain/dependent-secrets.ts'
import { dependentAlreadyTerminated, dependentNotFound, dependentStateChanged } from '../dependents-main.errors.ts'
import { findDependentRow, markDependentTerminated } from '../dependents-main.repository.ts'

export const terminateDependentInTransaction = async (
  tx: TransactionRunner,
  context: DependentsMainContext,
  input: TerminateDependentInput,
): Promise<ServiceResult<DependentDetail>> => {
  const now = context.clock.now()

  const before = await findDependentRow(tx, context.companyId, input.id)
  if (before === null) return fail([dependentNotFound()])
  if (before.status === DependentStatus.Terminated) return fail([dependentAlreadyTerminated()])

  const affectedRows = await markDependentTerminated(tx, context.companyId, input.id, {
    endDate: input.endDate,
    now,
  })
  if (affectedRows === 0) return fail([dependentStateChanged()])

  const beforeSnapshot: DependentAuditSnapshot = toPlaintextSnapshot(context.cipher, before)
  const afterSnapshot: DependentAuditSnapshot = {
    ...beforeSnapshot,
    endDate: input.endDate,
    status: DependentStatus.Terminated,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'dependents.main.terminate',
    subjectTable: 'employee_dependents',
    subjectId: input.id,
    changes: buildAuditChanges('employee_dependents', beforeSnapshot, afterSnapshot),
    effectiveDate: input.endDate,
    now,
  })

  const updated = await findDependentRow(tx, context.companyId, input.id)
  if (updated === null) {
    throw new Error(`眷屬 ${input.id} 終止扶養後於同一交易內讀不回來`)
  }
  return succeed(toMaskedDetail(context.cipher, updated))
}
