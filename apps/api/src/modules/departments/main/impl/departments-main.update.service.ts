/**
 * 業務動作：修改部門，含改上層部門（搬移子樹）與啟用／停用。
 *
 * **這支函式是資料字典「定案：樹的四條規則」裡三條規則的實際把關點**（規則 2 由複合外鍵配合
 * `findDepartmentDetail` 的公司範圍查詢一起擋，見下）：
 *
 * 1. **不得成環。** `wouldCreateCycle` 是唯一的檢查點——外鍵只管「上層存在」，不管「上層是不是
 *    自己的子孫」（`domain/department-tree.ts` 檔頭已詳述）。**自己設成自己的上層與「A→B→C
 *    把 A 的上層改成 C」是同一條規則抓到的兩種情況**，不需要分開判斷。
 * 2. **不得跨公司。** `findDepartmentDetail` 的公司範圍查詢是應用層的第一道防線，複合外鍵
 *    `fk_departments_parent` 是第二道（`db/schema/departments.ts`）。跨公司的候選上層與
 *    「上層根本不存在」回同一則錯誤（§3.2），因為兩者查到的都是 `null`。
 * 4. **搬移子樹不改寫任何員工的部門歷史。** 這是這支函式**故意沒有做的事**，而不是遺漏——
 *    `employee_department_histories` 記的是「那一天他在哪個部門」，部門自己搬家不改變那件事。
 *    本輪那張表還不存在，本檔沒有、也不該有任何一行程式碼去碰它。**日後那張表出現時**，
 *    看到這支函式的人若想「順手」補一段同步邏輯，請先回去讀資料字典那一條規則——不改寫歷史
 *    是定案，不是待辦。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：本動作本輪**沒有寫稽核**，
 * 理由與 `impl/departments-main.create.service.ts` 的同一則標記相同。修改部門尤其值得留意——
 * 「部門異動」是資料字典明列必須稽核的類別，而搬移子樹（改 `parentId`）正是最需要留下「異動
 * 前後差異」的一種操作。
 *
 * **本檔不開交易**：`updateDepartmentInTransaction` 只收外部交易 handle（`TransactionRunner`，
 * `db/client.ts`），開交易的包裝在入口檔的 `updateDepartment`（理由同 `create` 切片）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentsMainContext } from '../domain/department-context.ts'
import type { DepartmentDetail, UpdateDepartmentInput } from '../domain/department-model.ts'
import { wouldCreateCycle } from '../domain/department-tree.ts'
import {
  departmentCodeDuplicated,
  departmentNotFound,
  departmentParentCycle,
  departmentParentNotFound,
} from '../departments-main.errors.ts'
import { findDepartmentDetail, listDepartmentNodes, updateDepartmentProfile } from '../departments-main.repository.ts'

export const updateDepartmentInTransaction = async (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: UpdateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => {
  const now = context.clock.now()

  const current = await findDepartmentDetail(tx, context.companyId, input.id)
  // 動作類端點的「目標不存在」是業務錯誤（§3.1.3）。**別家公司的部門也走這一行**，
  // 回一模一樣的錯誤（§3.2）。
  if (current === null) return fail([departmentNotFound()])

  // 上層改成根（null）一律安全：不會成環（根沒有上層可以形成鏈），也沒有「上層是否存在」
  // 需要驗證。只有上層是某個既有部門時，才需要規則 1／規則 2 的兩項檢查。
  if (input.parentId !== null) {
    const nodes = await listDepartmentNodes(tx, context.companyId)
    // 規則 1：不得成環（含「設成自己」的 degenerate case，見 wouldCreateCycle 檔頭）。
    if (wouldCreateCycle(nodes, input.id, input.parentId)) return fail([departmentParentCycle()])

    // 規則 2：不得跨公司。查不到就代表上層不存在，或存在但屬於別家公司——兩者回同一則錯誤。
    const parent = await findDepartmentDetail(tx, context.companyId, input.parentId)
    if (parent === null) return fail([departmentParentNotFound()])
  }

  const outcome = await updateDepartmentProfile(tx, context.companyId, input.id, {
    parentId: input.parentId,
    code: input.code,
    name: input.name,
    description: input.description,
    status: input.status,
    now,
  })
  if (outcome === 'duplicate-code') return fail([departmentCodeDuplicated()])

  const updated = await findDepartmentDetail(tx, context.companyId, input.id)
  if (updated === null) {
    // 系統錯誤（§3.1.2）：同一交易內剛讀到、剛寫過的部門又讀不回來了。
    throw new Error(`部門 ${input.id} 更新後於同一交易內讀不回來`)
  }
  return succeed(updated)
}
