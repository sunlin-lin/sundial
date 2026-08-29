/**
 * 業務動作：刪除部門（軟刪除）。
 *
 * **規則 3（有子部門或有效成員時不得刪除）本輪只做「有子部門」那一半，這是暫時的，不是已完成
 * 的檢查。** 「有效成員」要查 `employee_department_histories`，那張表還不存在（資料字典
 * 「定案：樹的四條規則」第 3 條、計畫 §5 第 3 點）。**等那張表建立時**（計畫
 * `docs/plans/05-employee-onboarding.md` Stage 3），必須回來這裡補上「有有效成員」的檢查——
 * 少了它，刪除一個還有在職員工的部門會讓那些員工的部門歷史指向一個已經軟刪除的部門，
 * 而畫面上看不出任何異狀（歷史紀錄照樣顯示得出來，只是它指向的部門「不存在」了）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：理由同 `create` 切片。
 *
 * **本檔不開交易**：`deleteDepartmentInTransaction` 只收外部交易 handle（`TransactionRunner`，
 * `db/client.ts`），開交易的包裝在入口檔的 `deleteDepartment`（理由同 `create` 切片）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentsMainContext } from '../domain/department-context.ts'
import type { DeletedDepartment, DepartmentTargetInput } from '../domain/department-model.ts'
import { departmentHasChildren, departmentNotFound, departmentStateChanged } from '../departments-main.errors.ts'
import { findDepartmentDetail, hasChildDepartments, markDepartmentDeleted } from '../departments-main.repository.ts'

export const deleteDepartmentInTransaction = async (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: DepartmentTargetInput,
): Promise<ServiceResult<DeletedDepartment>> => {
  const now = context.clock.now()
  // 軟刪除時同時寫入非零的 deletedSeq（§4.3）：UNIQUE 索引中 NULL 互不相等，只寫 deletedAt
  // 的話「未刪除資料的部門代碼唯一」等於沒擋。用刪除當下的 epoch 毫秒，同一個部門只會被刪除
  // 一次，因此不可能與自己碰撞。
  const deletedSeq = context.clock.epochMs()

  const current = await findDepartmentDetail(tx, context.companyId, input.id)
  // 目標不存在與「屬於別家公司」回完全相同的一筆錯誤（§3.2、§3.1.3）。
  if (current === null) return fail([departmentNotFound()])

  // 規則 3（暫時只做這一半，見檔頭）：有子部門就拒絕，逼使用者先移轉子部門的上層。
  const hasChildren = await hasChildDepartments(tx, context.companyId, input.id)
  if (hasChildren) return fail([departmentHasChildren()])

  // 條件式 UPDATE ＋ 檢查影響列數（§4.4）：兩個使用者同時按刪除時，第二筆影響 0 列。
  const affectedRows = await markDepartmentDeleted(tx, context.companyId, input.id, { now, deletedSeq })
  if (affectedRows === 0) return fail([departmentStateChanged()])

  return succeed({ id: input.id })
}
