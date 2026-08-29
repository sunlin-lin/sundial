/**
 * 明文 ↔ 加密欄位 ↔ 遮罩輸出的對應（零 IO 純函式，§5.1）。理由與
 * `employees/main/domain/employee-secrets.ts` 檔頭同構：這段對應被多個資料存取動作
 * （insert／list／find／terminate）共用，抽成 `domain/` 的純函式，改一處就同步全部呼叫端。
 *
 * 遮罩發生在這裡，而不是在 handler：`toMaskedDetail` 解密後當場遮罩，明文一步都不往上層走。
 */
import type { Buffer } from 'node:buffer'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import { maskBirthday, maskIdentityNumber } from '../../../../db/field-masking.ts'
import { normalizeIdentityNumber } from '../../../../shared/identity-normalization.ts'
import type {
  DependentAuditSnapshot,
  DependentDetail,
  DependentProfileInput,
  DependentRelationshipCodeValue,
  DependentStatusValue,
} from './dependent-model.ts'

/** 寫入 `employee_dependents` 的加密欄位組。欄位名與 `db/schema/employee-dependents.ts` 逐字對應。 */
export type EncryptedDependentColumns = {
  readonly identityNumberEncrypted: Buffer
  readonly identityNumberHash: Buffer
  readonly birthdayEncrypted: Buffer
}

/** 一筆眷屬實際 select 回來的欄位（顯式 select，不是 `select *`，§2）。 */
export type DependentRow = {
  readonly id: string
  readonly employeeId: string
  readonly name: string
  readonly identityNumberEncrypted: Buffer
  readonly birthdayEncrypted: Buffer
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
 * 明文 → 要寫進資料庫的加密欄位。身分證先正規化再同時餵給加密與 blind index，理由見
 * `shared/identity-normalization.ts` 檔頭。
 */
export const toEncryptedColumns = (cipher: FieldCipher, profile: DependentProfileInput): EncryptedDependentColumns => {
  const identityNumber = normalizeIdentityNumber(profile.identityNumber)

  return {
    identityNumberEncrypted: cipher.encrypt(identityNumber),
    identityNumberHash: cipher.blindIndex(identityNumber),
    birthdayEncrypted: cipher.encrypt(profile.birthday),
  }
}

/** 一筆列 → 已遮罩的完整內容。 */
export const toMaskedDetail = (cipher: FieldCipher, row: DependentRow): DependentDetail => ({
  id: row.id,
  employeeId: row.employeeId,
  name: row.name,
  identityNumberMasked: maskIdentityNumber(cipher.decrypt(row.identityNumberEncrypted)),
  birthdayMasked: maskBirthday(cipher.decrypt(row.birthdayEncrypted)),
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
 * 一筆列 → **明文**稽核快照，只給稽核用（稽核計畫 §4.4）。
 *
 * 與 `toMaskedDetail` 是本檔僅有的兩支解密函式，但只有這一支解密後不遮罩，因此呼叫者必須被
 * 嚴格限制——回傳型別是 {@link DependentAuditSnapshot}，與端點回應型別（`DependentDetail`，
 * 一律 `xxxMasked`）完全不同，被 handler 誤用會是編譯錯誤。目前唯一合法的呼叫者是
 * `impl/dependents-main.terminate.service.ts`：終止前讀一筆明文快照當 `before`，
 * 理由與 `employees` 的 `toPlaintextProfile` 同構——`presence` 級變更判定必須基於明文。
 */
export const toPlaintextSnapshot = (cipher: FieldCipher, row: DependentRow): DependentAuditSnapshot => ({
  name: row.name,
  identityNumber: cipher.decrypt(row.identityNumberEncrypted),
  birthday: cipher.decrypt(row.birthdayEncrypted),
  relationshipCode: row.relationshipCode,
  isStudent: row.isStudent,
  isDisabled: row.isDisabled,
  isUnableToWork: row.isUnableToWork,
  isCohabiting: row.isCohabiting,
  effectiveDate: row.effectiveDate,
  endDate: row.endDate,
  status: row.status,
})
