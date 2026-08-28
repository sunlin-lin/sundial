/**
 * 資料存取：新增部門。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：兩個併發請求會同時查到
 * 「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現，測試環境重現不了。
 *
 * **上層是否存在且同公司的檢查不在這裡**：那是呼叫端（`impl/departments-main.create.service.ts`）
 * 在同一交易內、insert 之前用 `findDepartmentDetail` 做的事——不是因為本函式懶得管，是因為
 * 「上層存在」是一條業務規則（有專屬的錯誤碼 `parent-not-found`），而 insert 只負責把資料寫進去。
 * 就算漏了那個檢查，複合外鍵 `fk_departments_parent` 仍然是最後一道防線，只是那時候會以系統
 * 錯誤（外鍵違反）的形式出現，而不是一句清楚的業務訊息。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import { departments, type DepartmentStatusValue } from '../../../../db/schema/index.ts'
import { isDuplicateDepartmentCode, type DepartmentInsertOutcome } from '../domain/department-duplicate.ts'

export type NewDepartment = {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly status: DepartmentStatusValue
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertDepartment = async (
  runner: QueryRunner,
  companyId: string,
  department: NewDepartment,
): Promise<DepartmentInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)

  try {
    await tenant.insert(departments, (scopedCompanyId) => ({
      id: department.id,
      companyId: scopedCompanyId,
      parentId: department.parentId,
      code: department.code,
      name: department.name,
      description: department.description,
      status: department.status,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: department.now,
      updatedAt: department.now,
    }))
    return 'inserted'
  } catch (error) {
    if (isDuplicateDepartmentCode(error)) return 'duplicate-code'
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因，交給統一 error handler 記錄。
    // 這包含複合外鍵違反（呼叫端漏做上層存在性檢查、或併發下上層剛好被刪除的極端情況）——
    // 那不是使用者填錯了什麼，是本模組的業務檢查沒接住，必須以系統錯誤的形式被看見。
    throw error
  }
}
