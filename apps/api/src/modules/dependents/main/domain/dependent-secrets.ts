/**
 * 明文欄位 ↔ 遮罩輸出的對應（零 IO 純函式）。理由與
 * `employees/main/domain/employee-secrets.ts` 檔頭同構：應用層欄位加密已移除，
 * `employee_dependents` 的身分證字號、生日改回明文欄位儲存，改由資料庫端靜態加密負責
 * （見 `db/schema/employee-dependents.ts` 檔頭）。本檔不再需要 `FieldCipher`。
 *
 * 遮罩仍然保留，且發生在這裡：`toMaskedDetail` 讀出明文後當場遮罩，明文一步都不往上層走，
 * §5.1「對外回應一律遮罩」不因為儲存方式改變而改變。
 *
 * ## 為什麼讀出來的列上，`identityNumber`／`birthday` 是 `string | null`
 *
 * 理由與 `employees/main/domain/employee-secrets.ts` 檔頭同構：`db/schema/employee-dependents.ts`
 * 的新欄位這一輪暫時 nullable，回填前的舊資料讀出來是 `null`。`toMaskedDetail`／
 * `toPlaintextSnapshot` 讀到 `null` 會直接拋例外（見 `requirePlaintext`），不會靜默用空字串
 * 或遮罩字元頂替。
 */
import { maskBirthday, maskIdentityNumber } from '../../../../db/field-masking.ts'
import { normalizeIdentityNumber } from '../../../../shared/identity-normalization.ts'
import type {
  DependentAuditSnapshot,
  DependentDetail,
  DependentProfileInput,
  DependentRelationshipCodeValue,
  DependentStatusValue,
} from './dependent-model.ts'

/** 寫入 `employee_dependents` 的明文欄位組。欄位名與 `db/schema/employee-dependents.ts` 逐字對應。 */
export type StoredDependentColumns = {
  readonly identityNumber: string
  readonly birthday: string
}

/** 一筆眷屬實際 select 回來的欄位（顯式 select，不是 `select *`，§2）。 */
export type DependentRow = {
  readonly id: string
  readonly employeeId: string
  readonly name: string
  readonly identityNumber: string | null
  readonly birthday: string | null
  readonly relationshipCode: DependentRelationshipCodeValue
  readonly isStudent: boolean
  readonly isDisabled: boolean
  readonly isUnableToWork: boolean
  readonly isCohabiting: boolean
  readonly effectiveDate: string
  readonly endDate: string | null
  readonly status: DependentStatusValue
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 明文輸入 → 要寫進資料庫的明文欄位。身分證先正規化，理由見
 * `shared/identity-normalization.ts` 檔頭：正規化後的值同時是寫入值，也是唯一鍵
 * （`uq_employee_dependents_company_employee_identity_plain`）真正比對的值。
 */
export const toStoredColumns = (profile: DependentProfileInput): StoredDependentColumns => {
  const identityNumber = normalizeIdentityNumber(profile.identityNumber)

  return {
    identityNumber,
    birthday: profile.birthday,
  }
}

/**
 * 讀出來的欄位是 `null` 時直接拋例外（系統錯誤，§3.1.2），理由與
 * `employees/main/domain/employee-secrets.ts` 的同名函式逐字相同。
 */
const requirePlaintext = (value: string | null, field: string, dependentId: string): string => {
  if (value === null) {
    throw new Error(
      `眷屬 ${dependentId} 的 ${field} 尚未回填明文欄位（見 apps/api/scripts/backfill-plaintext.ts），` +
        '無法提供對外回應',
    )
  }
  return value
}

/** 一筆列 → 已遮罩的完整內容。 */
export const toMaskedDetail = (row: DependentRow): DependentDetail => ({
  id: row.id,
  employeeId: row.employeeId,
  name: row.name,
  identityNumberMasked: maskIdentityNumber(requirePlaintext(row.identityNumber, 'identityNumber', row.id)),
  birthdayMasked: maskBirthday(requirePlaintext(row.birthday, 'birthday', row.id)),
  relationshipCode: row.relationshipCode,
  isStudent: row.isStudent,
  isDisabled: row.isDisabled,
  isUnableToWork: row.isUnableToWork,
  isCohabiting: row.isCohabiting,
  effectiveDate: row.effectiveDate,
  endDate: row.endDate,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/**
 * 一筆列 → 稽核快照，只給稽核用（稽核計畫 §4.4）。
 *
 * 與 `toMaskedDetail` 是本檔僅有的兩支映射函式，但只有這一支不遮罩，因此呼叫者必須被嚴格
 * 限制——回傳型別是 {@link DependentAuditSnapshot}，與端點回應型別（`DependentDetail`，一律
 * `xxxMasked`）完全不同，被 handler 誤用會是編譯錯誤。目前唯一合法的呼叫者是
 * `impl/dependents-main.terminate.service.ts`：終止前讀一筆快照當 `before`。
 *
 * 架構變更後這支函式已經是零轉換的映射（過去需要解密，現在本來就是明文），保留獨立函式與型別
 * 的理由與 `employees` 的 `toPlaintextProfile` 相同：維持「稽核用途專用」這個邊界。
 */
export const toPlaintextSnapshot = (row: DependentRow): DependentAuditSnapshot => ({
  name: row.name,
  identityNumber: requirePlaintext(row.identityNumber, 'identityNumber', row.id),
  birthday: requirePlaintext(row.birthday, 'birthday', row.id),
  relationshipCode: row.relationshipCode,
  isStudent: row.isStudent,
  isDisabled: row.isDisabled,
  isUnableToWork: row.isUnableToWork,
  isCohabiting: row.isCohabiting,
  effectiveDate: row.effectiveDate,
  endDate: row.endDate,
  status: row.status,
})
