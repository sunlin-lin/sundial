/**
 * 明文 ↔ 加密欄位 ↔ 遮罩輸出的對應（零 IO 純函式，§5.1）。
 *
 * **為什麼在 `domain/` 而不是某個 repository 切片裡：** 這段對應被四個資料存取動作用到
 * （list／find／insert／update），而 §0.4 明文規定實作切片之間不得互相 import，
 * 需要共用時只有兩條路——升格成入口上的一個動作，或「若不碰 IO，抽成 `domain/` 的純函式」。
 * 加解密與遮罩都是純計算（金鑰由參數傳進來，不讀環境變數、不碰資料庫），走的是第二條。
 * 留在切片裡的話就得複製四份，而**改一處漏三處不會有任何地方變紅**——漏掉的那一支
 * 只是靜靜地少遮一個欄位，或用不同的規則算出對不上的 blind index。
 *
 * ## 遮罩發生在這裡，而不是在 handler
 *
 * `toMaskedSummary`／`toMaskedDetail` **解密後當場遮罩**，明文一步都不往上層走
 * （理由見 `employee-model.ts` 的檔頭）。因此「對外回應一律遮罩」（§5.1）不是一條要記得遵守的
 * 規則，而是上層**拿不到明文**這個事實。
 */
import type { Buffer } from 'node:buffer'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import {
  maskAddress,
  maskBirthday,
  maskIdentityNumber,
  maskOptionalEmail,
  maskPhone,
} from '../../../../db/field-masking.ts'
import { normalizeIdentityNumber } from './employee-identity.ts'
import type { EmployeeDetail, EmployeeProfileInput, EmployeeSummary, GenderValue } from './employee-model.ts'

/** 寫入 `employees` 的加密欄位組。欄位名與 `db/schema/employees.ts` 逐字對應。 */
export type EncryptedEmployeeColumns = {
  readonly identityNumberEncrypted: Buffer
  readonly identityNumberHash: Buffer
  readonly birthdayEncrypted: Buffer
  readonly phoneEncrypted: Buffer
  readonly emailEncrypted: Buffer | null
  readonly addressEncrypted: Buffer
}

/** 清單查詢實際 select 回來的欄位（顯式 select，不是 `select *`，§2）。 */
export type EmployeeSummaryRow = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumberEncrypted: Buffer
}

/** 單筆查詢實際 select 回來的欄位。 */
export type EmployeeDetailRow = EmployeeSummaryRow & {
  readonly birthdayEncrypted: Buffer
  readonly phoneEncrypted: Buffer
  readonly emailEncrypted: Buffer | null
  readonly addressEncrypted: Buffer
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 明文 → 要寫進資料庫的加密欄位。
 *
 * 身分證**先正規化再同時餵給加密與 blind index**：兩者吃的必須是同一個字串，
 * 否則解密回來的值與拿去算雜湊的值不是同一個東西，日後任何重算雜湊的維護作業都會對不上
 * （見 `employee-identity.ts`）。
 *
 * Email 是選填：`null` 原樣寫成 NULL，**不加密一個空字串**——加密後的空字串在資料庫裡
 * 是一串看起來很正常的位元組，於是「沒填」與「填了空字串」再也分不出來。
 */
export const toEncryptedColumns = (cipher: FieldCipher, profile: EmployeeProfileInput): EncryptedEmployeeColumns => {
  const identityNumber = normalizeIdentityNumber(profile.identityNumber)

  return {
    identityNumberEncrypted: cipher.encrypt(identityNumber),
    identityNumberHash: cipher.blindIndex(identityNumber),
    birthdayEncrypted: cipher.encrypt(profile.birthday),
    phoneEncrypted: cipher.encrypt(profile.phone),
    emailEncrypted: profile.email === null ? null : cipher.encrypt(profile.email),
    addressEncrypted: cipher.encrypt(profile.address),
  }
}

/** 清單列 → 已遮罩的列表單筆。 */
export const toMaskedSummary = (cipher: FieldCipher, row: EmployeeSummaryRow): EmployeeSummary => ({
  id: row.id,
  employeeCode: row.employeeCode,
  name: row.name,
  gender: row.gender,
  identityNumberMasked: maskIdentityNumber(cipher.decrypt(row.identityNumberEncrypted)),
})

/** 單筆列 → 已遮罩的完整內容。 */
export const toMaskedDetail = (cipher: FieldCipher, row: EmployeeDetailRow): EmployeeDetail => ({
  ...toMaskedSummary(cipher, row),
  birthdayMasked: maskBirthday(cipher.decrypt(row.birthdayEncrypted)),
  phoneMasked: maskPhone(cipher.decrypt(row.phoneEncrypted)),
  emailMasked: maskOptionalEmail(row.emailEncrypted === null ? null : cipher.decrypt(row.emailEncrypted)),
  addressMasked: maskAddress(cipher.decrypt(row.addressEncrypted)),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/** 稽核用明文快照實際 select 回來的欄位：只有寫進 `EmployeeProfileInput` 那八欄需要的密文。 */
export type EmployeeProfileRow = {
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumberEncrypted: Buffer
  readonly birthdayEncrypted: Buffer
  readonly phoneEncrypted: Buffer
  readonly emailEncrypted: Buffer | null
  readonly addressEncrypted: Buffer
}

/**
 * 單筆列 → **明文**業務快照，只給稽核用（稽核計畫 §4.4）。
 *
 * **這是本檔唯一一支解密後不遮罩的函式，因此呼叫者必須被嚴格限制。** 它的回傳型別是
 * `EmployeeProfileInput`——與端點回應型別（一律 `xxxMasked`，見 `employee-model.ts` 檔頭）完全
 * 不同，因此被 handler 誤用會是一個編譯錯誤，不是一個要在 review 時抓的疏忽。目前唯一合法的
 * 呼叫者是 `impl/employees-main.find-audit-snapshot.repository.ts`，它只把結果交給
 * `buildAuditChanges`：稽核的 `presence` 級變更判定必須基於明文（拿密文比對的話，AES-256-GCM
 * 每次寫入不同的 IV 會讓「什麼都沒改」的欄位也被誤判為變更，理由完整寫在
 * `modules/audit/main/domain/audit-change-set.ts` 檔頭）。
 */
export const toPlaintextProfile = (cipher: FieldCipher, row: EmployeeProfileRow): EmployeeProfileInput => ({
  employeeCode: row.employeeCode,
  name: row.name,
  gender: row.gender,
  identityNumber: cipher.decrypt(row.identityNumberEncrypted),
  birthday: cipher.decrypt(row.birthdayEncrypted),
  phone: cipher.decrypt(row.phoneEncrypted),
  email: row.emailEncrypted === null ? null : cipher.decrypt(row.emailEncrypted),
  address: cipher.decrypt(row.addressEncrypted),
})
