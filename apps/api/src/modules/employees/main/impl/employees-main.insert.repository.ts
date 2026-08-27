/**
 * 資料存取：新增員工。
 *
 * **唯一性由資料庫的唯一鍵擋，不做「先 SELECT 再 INSERT」**（§4.3）：兩個併發請求會同時查到
 * 「沒有」然後都寫進去，而那個 bug 只在同時送出時才出現，測試環境重現不了。
 * 這裡直接寫入並攔截唯一鍵違反，轉成一個業務結果交給 service 判斷。
 *
 * 身分證的重複之所以擋得住，靠的是 `identity_number_hash` 這個 blind index
 * ——加密值每次的 IV 都不同，同一個身分證寫兩次會得到兩串不同的位元組，
 * 建在密文上的唯一鍵**一次也擋不到**（而且看起來是有設的）。
 */
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
import { classifyEmployeeDuplicate, type EmployeeDuplicateOutcome } from '../domain/employee-duplicate.ts'
import type { EmployeeProfileInput } from '../domain/employee-model.ts'
import { toEncryptedColumns } from '../domain/employee-secrets.ts'

export type EmployeeInsertOutcome = 'inserted' | EmployeeDuplicateOutcome

export type NewEmployee = {
  readonly id: string
  readonly profile: EmployeeProfileInput
  /** 台北牆鐘時間，由注入的 clock 取得（§6.2）。 */
  readonly now: string
}

export const insertEmployee = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employee: NewEmployee,
): Promise<EmployeeInsertOutcome> => {
  const tenant = new TenantDatabase(runner, companyId)
  // 加密在寫入的最後一刻才做，明文不在本函式以外存在（§5.1）。
  const encrypted = toEncryptedColumns(cipher, employee.profile)

  try {
    await tenant.insert(employees, (scopedCompanyId) => ({
      id: employee.id,
      companyId: scopedCompanyId,
      employeeCode: employee.profile.employeeCode,
      name: employee.profile.name,
      gender: employee.profile.gender,
      ...encrypted,
      deletedAt: null,
      deletedSeq: 0,
      createdAt: employee.now,
      updatedAt: employee.now,
    }))
    return 'inserted'
  } catch (error) {
    const duplicate = classifyEmployeeDuplicate(error)
    if (duplicate !== null) return duplicate
    // 其餘一律是系統錯誤（§3.1.2）：原樣重拋，保留堆疊與成因，交給統一 error handler 記錄。
    // **刻意不把 `error` 包進帶著明文的新訊息裡**——例外訊息會進 log，而 §5.1 禁止明文進 log。
    throw error
  }
}
