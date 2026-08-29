/**
 * 業務動作：新增部門。
 *
 * **不得跨公司（規則 2）**：不是靠應用層記得比對，而是 `findDepartmentDetail` 本身把公司條件
 * 寫進查詢的 `WHERE`（§4.2）——候選上層若屬於別家公司，這裡查到的就是 `null`，與「上層根本
 * 不存在」走的是同一行程式碼、回同一則錯誤（§3.2）。複合外鍵 `fk_departments_parent` 是這條
 * 規則的第二道防線（`db/schema/departments.ts`），本函式的檢查則負責在寫入前就給出一句業務
 * 訊息，而不是讓使用者撞見一個外鍵違反的系統錯誤。
 *
 * **不需要成環檢查**（規則 1）：新建立的部門一定沒有子孫，把任何既有部門設成它的上層都不可能
 * 成環。成環只在**搬移既有部門**（`update`）時才有意義，見該檔的 `wouldCreateCycle` 呼叫。
 *
 * **`status` 一律是 `DepartmentStatus.Active`**：UI 定案「建立時由系統帶入…初始 status」
 * （`docs/ui/08-ui-organization-structure.md`），輸入型別裡根本沒有這個欄位（`domain/
 * department-model.ts` 的 `CreateDepartmentInput` 註解已詳述）。
 *
 * TODO(稽核 Stage 2 定案後補；`docs/plans/02-audit-logs.md`)：本動作本輪**沒有寫稽核**。
 * 部門異動是資料字典明列必須稽核的類別（「部門、職稱及職務異動」），但稽核表尚未定案
 * （後端規範 §9 第 2 項），刻意不自建，理由與 `shifts-main.create.service.ts` 的同類標記相同
 * ——猜錯欄位的代價不是改個 schema，是一批無法重寫也無法補齊的紀錄。
 *
 * **本檔不開交易**：`createDepartmentInTransaction` 只收外部交易 handle（`TransactionRunner`，
 * `db/client.ts`），開交易的包裝在入口檔的 `createDepartment`——理由與 `employees/main` 等動作
 * 相同（計畫 §4.1：會被 Stage 4 編排的動作一律能收外部交易 handle）。
 */
import type { TransactionRunner } from '../../../../db/client.ts'
import { DepartmentStatus } from '../../../../db/schema/index.ts'
import { fail, succeed, type ServiceResult } from '../../../../shared/service-result.ts'
import type { DepartmentsMainContext } from '../domain/department-context.ts'
import type { CreateDepartmentInput, DepartmentDetail } from '../domain/department-model.ts'
import { departmentCodeDuplicated, departmentParentNotFound } from '../departments-main.errors.ts'
import { findDepartmentDetail, insertDepartment } from '../departments-main.repository.ts'

export const createDepartmentInTransaction = async (
  tx: TransactionRunner,
  context: DepartmentsMainContext,
  input: CreateDepartmentInput,
): Promise<ServiceResult<DepartmentDetail>> => {
  const now = context.clock.now()
  const departmentId = crypto.randomUUID()

  if (input.parentId !== null) {
    const parent = await findDepartmentDetail(tx, context.companyId, input.parentId)
    if (parent === null) return fail([departmentParentNotFound()])
  }

  // 代碼唯一性交給資料庫的唯一鍵，不做「先 SELECT 再 INSERT」（§4.3）：兩個併發請求會同時
  // 查到「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現。
  const outcome = await insertDepartment(tx, context.companyId, {
    id: departmentId,
    parentId: input.parentId,
    code: input.code,
    name: input.name,
    description: input.description,
    status: DepartmentStatus.Active,
    now,
  })
  if (outcome === 'duplicate-code') return fail([departmentCodeDuplicated()])

  const detail = await findDepartmentDetail(tx, context.companyId, departmentId)
  if (detail === null) {
    // 系統錯誤（§3.1.2）：剛剛在同一個交易內寫進去的部門讀不回來，代表資料庫或本模組的
    // 公司範圍有問題，不是使用者做錯了什麼。
    throw new Error(`部門 ${departmentId} 建立後於同一交易內讀不回來`)
  }
  return succeed(detail)
}
