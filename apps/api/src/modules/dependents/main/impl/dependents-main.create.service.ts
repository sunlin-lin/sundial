/**
 * 業務動作：新增眷屬。
 *
 * **沒有 §4.3 的期間重疊處置**，理由寫在 `db/schema/employee-dependents.ts` 檔頭：多名眷屬本來
 * 就可以同時有效，唯一要防的重複（同一員工同一身分證）交給資料庫唯一鍵直接擋，不做
 * 「先查一批既有紀錄、鎖住再比較」，因此也不需要 `FOR UPDATE`。
 *
 * **本檔不開交易**：`createDependentInTransaction` 只收外部交易 handle，開交易的包裝在入口檔
 * `dependents-main.service.ts` 的 `createDependent`。`recordAudit` 收 `TransactionRunner`，
 * 傳裸連線池是編譯錯誤。
 *
 * **眷屬身分證比照員工，加密＋blind index，稽核只記 `presence`（有沒有改），不記值**：
 * `DependentProfileInput.identityNumber` 與 `birthday` 在 `AUDIT_FIELD_POLICY.employee_dependents`
 * 都是 `presence` 級（對應到 `*_encrypted` 欄位者一律 presence，見該政策檔的說明）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { buildAuditChanges, recordAudit } from '../../../audit/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import { DependentStatus } from '../../../../db/schema/index.ts'
import type { DependentsMainContext } from '../domain/dependent-context.ts'
import type { CreateDependentInput, DependentAuditSnapshot, DependentDetail } from '../domain/dependent-model.ts'
import { dependentEmployeeNotFound, dependentIdentityNumberDuplicated } from '../dependents-main.errors.ts'
import { findDependentRow, findEmployeeForReference, insertDependent } from '../dependents-main.repository.ts'
import { toMaskedDetail } from '../domain/dependent-secrets.ts'

export const createDependentInTransaction = async (
  tx: TransactionRunner,
  context: DependentsMainContext,
  input: CreateDependentInput,
): Promise<ServiceResult<DependentDetail>> => {
  const now = context.clock.now()
  const dependentId = crypto.randomUUID()

  const employee = await findEmployeeForReference(tx, context.companyId, input.employeeId)
  if (employee === null) return fail([dependentEmployeeNotFound()])

  const outcome = await insertDependent(tx, context.companyId, {
    id: dependentId,
    employeeId: input.employeeId,
    profile: input,
    now,
  })
  // 重複時立刻結束、不再對這個交易下任何一句寫入（§3.4），理由與 `employees-main.create.service.ts` 同構。
  if (outcome === 'duplicate-identity-number') return fail([dependentIdentityNumberDuplicated()])

  const after: DependentAuditSnapshot = {
    name: input.name,
    identityNumber: input.identityNumber,
    birthday: input.birthday,
    relationshipCode: input.relationshipCode,
    isStudent: input.isStudent,
    isDisabled: input.isDisabled,
    isUnableToWork: input.isUnableToWork,
    isCohabiting: input.isCohabiting,
    effectiveDate: input.effectiveDate,
    endDate: null,
    status: DependentStatus.Active,
  }

  await recordAudit(tx, {
    companyId: context.companyId,
    actor: { type: 'company-user', companyUserId: context.operatorCompanyUserId },
    action: 'dependents.main.create',
    subjectTable: 'employee_dependents',
    subjectId: dependentId,
    changes: buildAuditChanges('employee_dependents', null, after),
    effectiveDate: input.effectiveDate,
    now,
  })

  const row = await findDependentRow(tx, context.companyId, dependentId)
  if (row === null) {
    // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的眷屬讀不回來，代表資料庫或本模組的
    // 公司範圍有問題，不是使用者做錯了什麼。訊息只帶 id，不帶任何個資（§5.1）。
    throw new Error(`眷屬 ${dependentId} 建立後於同一交易內讀不回來`)
  }
  return succeed(toMaskedDetail(row))
}
