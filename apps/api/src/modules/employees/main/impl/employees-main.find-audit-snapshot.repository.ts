/**
 * 資料存取：單一員工的**稽核用明文快照**（稽核計畫 §4.4）。
 *
 * 與 `find.repository.ts` 的差別只在最後一步的映射：那一支解密後**當場遮罩**（明文一步都不往
 * 上層走，§5.1），本支解密後**回明文**——唯一合法的呼叫者是稽核（透過 `buildAuditChanges`），
 * 理由與 `toPlaintextProfile` 的檔頭相同：`presence` 級的變更判定必須基於明文，拿密文比對的話，
 * AES-256-GCM 每次寫入不同的 IV 會讓「什麼都沒改」的欄位也被誤判為變更。
 *
 * **SELECT 與 `find.repository.ts` 重複，是刻意的，不是漏了共用。** 兩者是不同的資料存取動作
 * （一個回遮罩、一個回明文），而 `impl/` 底下的切片彼此不得互相 import（§0.4）；要共用只能升格
 * 成入口上的動作再互相呼叫，但兩支動作各自只有一行委派，硬拆一支「共用的 select」出來換不到
 * 什麼，反而多一層要維護的間接。真正共用的是零 IO 的解密映射（`toPlaintextProfile`），已經在
 * `domain/employee-secrets.ts`。
 */
import { eq, isNull } from 'drizzle-orm'
import { TenantDatabase, type QueryRunner } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { employees } from '../../../../db/schema/index.ts'
import type { EmployeeProfileInput } from '../domain/employee-model.ts'
import { toPlaintextProfile } from '../domain/employee-secrets.ts'

/**
 * 依 id 取員工的明文業務快照。
 *
 * @returns 查無資料回 `null`，**別家公司的員工也回 `null`**（公司條件由 `TenantDatabase` 補上，
 *   §4.2），與 `findEmployeeDetail` 同一種處置。已軟刪除的員工同樣視為不存在（§4.3）——
 *   刪除當下呼叫端已經另外用這支函式讀過「刪除前」的快照（見 `employees-main.delete.service.ts`），
 *   這裡不需要、也不該把已刪除的資料當成活著的。
 */
export const findEmployeeAuditSnapshot = async (
  runner: QueryRunner,
  cipher: FieldCipher,
  companyId: string,
  employeeId: string,
): Promise<EmployeeProfileInput | null> => {
  const tenant = new TenantDatabase(runner, companyId)

  const [row] = await tenant.select(
    {
      employeeCode: employees.employeeCode,
      name: employees.name,
      gender: employees.gender,
      identityNumberEncrypted: employees.identityNumberEncrypted,
      birthdayEncrypted: employees.birthdayEncrypted,
      phoneEncrypted: employees.phoneEncrypted,
      emailEncrypted: employees.emailEncrypted,
      addressEncrypted: employees.addressEncrypted,
    },
    employees,
    eq(employees.id, employeeId),
    eq(employees.deletedSeq, 0),
    isNull(employees.deletedAt),
  )

  return row === undefined ? null : toPlaintextProfile(cipher, row)
}
