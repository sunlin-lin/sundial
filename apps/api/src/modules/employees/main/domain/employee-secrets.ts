/**
 * 明文欄位 ↔ 遮罩輸出的對應（零 IO 純函式）。
 *
 * **架構變更（§5.1 現況）：本檔原本也管「明文 ↔ 加密欄位」這一段，現在拿掉了。** 應用層欄位加密
 * 已移除，`employees` 的敏感個資改回明文欄位儲存，改由資料庫端靜態加密負責（現況與代價見
 * `docs/dev-standards-backend.md` §5.1）。本檔因此不再需要 `FieldCipher`，也不再做任何加解密。
 *
 * **遮罩仍然保留，且發生在這裡。** 加密與遮罩原本是「同一條規則的兩半」（加密決定資料庫裡不能有
 * 明文，遮罩決定回應裡不能有明文）；現在資料庫裡本來就有明文，但遮罩這一半完全沒有變——§5.1
 * 「對外回應一律遮罩」是獨立於儲存方式的規則，`toMaskedSummary`／`toMaskedDetail` 讀出明文後
 * **當場遮罩**，明文一步都不往上層走，理由與加密時代完全相同。
 *
 * **為什麼還在 `domain/` 而不是併回 repository 切片：** 這段對應被四個資料存取動作用到
 * （list／find／insert／update），而 §0.4 明文規定實作切片之間不得互相 import，需要共用時只有
 * 兩條路——升格成入口上的一個動作，或「若不碰 IO，抽成 `domain/` 的純函式」。這裡走第二條，
 * 理由與加密時代相同：留在切片裡的話就得複製四份，改一處漏三處不會有任何地方變紅。
 *
 * ## 為什麼讀出來的列上，這幾欄的型別是 `string | null`
 *
 * `db/schema/employees.ts` 的新欄位這一輪**暫時 nullable**（見該檔檔頭）：既有資料要靠回填
 * 腳本（`apps/api/scripts/backfill-plaintext.ts`）補上，回填完成、下一輪拿掉舊欄位時才會轉
 * `NOT NULL`。因此 select 出來的型別如實反映「回填前可能是 NULL」，`toMaskedSummary` 等函式
 * 讀到 `null` 時**必須直接拋例外，不能靜默用空字串或 `***` 頂替**——那樣會讓「這筆還沒回填」與
 * 「這個人的身分證真的是空的」在畫面上分不出來，而回填有沒有漏掉一筆正是下一輪 drop 欄位前
 * 最需要抓到的事（見 `requirePlaintext`）。
 */
import {
  maskAddress,
  maskBirthday,
  maskIdentityNumber,
  maskOptionalEmail,
  maskPhone,
} from '../../../../db/field-masking.ts'
import { normalizeIdentityNumber } from './employee-identity.ts'
import type {
  EmployeeDetail,
  EmployeeProfileInput,
  EmployeeProfileUpdateInput,
  EmployeeSummary,
  GenderValue,
} from './employee-model.ts'

/** 寫入 `employees` 的明文欄位組。欄位名與 `db/schema/employees.ts` 逐字對應。 */
export type StoredEmployeeColumns = {
  readonly identityNumber: string
  readonly birthday: string
  readonly phone: string
  readonly email: string | null
  readonly address: string
}

/**
 * 清單查詢實際 select 回來的欄位（顯式 select，不是 `select *`，§2）。
 *
 * `identityNumber` 是 `string | null`：對應資料庫欄位這一輪暫時 nullable（回填前的舊資料），
 * 理由見檔頭。`toMaskedSummary` 讀到 `null` 會直接拋例外，不會把 `null` 悄悄遮罩成看似正常的值。
 */
export type EmployeeSummaryRow = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber: string | null
}

/** 單筆查詢實際 select 回來的欄位。`birthday`／`phone`／`address` 同樣暫時可能是 `null`，理由同上。 */
export type EmployeeDetailRow = EmployeeSummaryRow & {
  readonly birthday: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly address: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 讀出來的欄位是 `null` 時直接拋例外（系統錯誤，§3.1.2），不是業務拒絕。
 *
 * 只有兩種情況會讀到 `null`：這筆資料還沒被回填腳本處理過（回填漏了一筆），或程式邏輯本身有錯
 * （寫入路徑忘了帶值）——兩者都不是使用者能做什麼來補救的，必須帶著 id 與欄位名帶入告警，
 * 而不是讓遮罩函式收到 `null` 之後自己炸出一個看不出成因的型別錯誤，或更糟——被某個遮罩函式
 * 悄悄接受、印出一個看似正常實則錯誤的畫面。
 */
const requirePlaintext = (value: string | null, field: string, employeeId: string): string => {
  if (value === null) {
    throw new Error(
      `員工 ${employeeId} 的 ${field} 尚未回填明文欄位（見 apps/api/scripts/backfill-plaintext.ts），` +
        '無法提供對外回應',
    )
  }
  return value
}

/**
 * 明文輸入 → 要寫進資料庫的明文欄位。
 *
 * 身分證先正規化（見 `employee-identity.ts`）——正規化後的值同時是寫入值，也是唯一鍵
 * （`uq_employees_company_identity_plain`）真正比對的值：不正規化的話，同一個身分證只是大小寫
 * 不同就能被建立兩次，唯一鍵一次也擋不到。
 *
 * Email 是選填：`null` 原樣寫成 NULL，語意與過去相同——`null` 代表「沒填」，不是「填了空字串」。
 */
export const toStoredColumns = (profile: EmployeeProfileInput): StoredEmployeeColumns => {
  const identityNumber = normalizeIdentityNumber(profile.identityNumber)

  return {
    identityNumber,
    birthday: profile.birthday,
    phone: profile.phone,
    email: profile.email,
    address: profile.address,
  }
}

/**
 * 修改員工用：**只帶「有送」的欄位**（省略＝不變更，見 `EmployeeProfileUpdateInput` 檔頭）。
 *
 * 省略的欄位完全不出現在回傳物件的 key 裡（不是「key 存在、值是 undefined」）：呼叫端
 * （`impl/employees-main.update-profile.repository.ts`）用 `...columns` 展開進 `UPDATE` 的
 * `SET` 子句，沒有這個 key 就代表那一欄完全不進 `SET`，資料庫裡的原值因此不會被覆寫。
 *
 * 身分證與其餘三欄各自獨立判斷是否提供：它們對應資料庫裡彼此獨立的欄位，互不影響。
 *
 * `email` 不判斷是否提供——{@link EmployeeProfileUpdateInput.email} 本來就是必填的
 * `string | null`，`null` 原樣寫成 NULL，語意與 `toStoredColumns` 對 email 的處理完全相同。
 */
export const toStoredColumnsForUpdate = (profile: EmployeeProfileUpdateInput): Partial<StoredEmployeeColumns> => {
  const columns: { -readonly [K in keyof StoredEmployeeColumns]?: StoredEmployeeColumns[K] } = {
    email: profile.email,
  }

  if (profile.identityNumber !== undefined) columns.identityNumber = normalizeIdentityNumber(profile.identityNumber)
  if (profile.birthday !== undefined) columns.birthday = profile.birthday
  if (profile.phone !== undefined) columns.phone = profile.phone
  if (profile.address !== undefined) columns.address = profile.address

  return columns
}

/** 清單列 → 已遮罩的列表單筆。 */
export const toMaskedSummary = (row: EmployeeSummaryRow): EmployeeSummary => ({
  id: row.id,
  employeeCode: row.employeeCode,
  name: row.name,
  gender: row.gender,
  identityNumberMasked: maskIdentityNumber(requirePlaintext(row.identityNumber, 'identityNumber', row.id)),
})

/**
 * 單筆列 → 已遮罩的完整內容。
 *
 * **`companyUserId` 由呼叫端傳入，不是本函式自己查的**：本檔是零 IO 的純函式集合（見檔頭），
 * 「這位員工目前有效的登入帳號 id」需要另一次資料庫查詢（`company_users` 一對多，見
 * `impl/employees-main.find.repository.ts` 檔頭），查詢屬於呼叫端的責任；這裡只負責把查好的值
 * 併進最終的 {@link EmployeeDetail} 形狀，讓「組出這個型別」這件事只有一個地方在做。
 */
export const toMaskedDetail = (row: EmployeeDetailRow, companyUserId: string | null): EmployeeDetail => ({
  ...toMaskedSummary(row),
  birthdayMasked: maskBirthday(requirePlaintext(row.birthday, 'birthday', row.id)),
  phoneMasked: maskPhone(requirePlaintext(row.phone, 'phone', row.id)),
  // email 是唯一真正選填的欄位（`null` = 沒填，不是尚未回填），不經過 `requirePlaintext`。
  emailMasked: maskOptionalEmail(row.email),
  addressMasked: maskAddress(requirePlaintext(row.address, 'address', row.id)),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  companyUserId,
})

/**
 * 稽核用明文快照實際 select 回來的欄位：只有寫進 `EmployeeProfileInput` 那八欄需要的欄位。
 * 四欄暫時可能是 `null`（回填前的舊資料），理由見檔頭。
 */
export type EmployeeProfileRow = {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly gender: GenderValue
  readonly identityNumber: string | null
  readonly birthday: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly address: string | null
}

/**
 * 單筆列 → 業務快照，只給稽核用（稽核計畫 §4.4）。
 *
 * **架構變更後這支函式不再做任何解密**：過去需要解密，現在資料庫裡本來就是明文，只是仍然要
 * 通過 `requirePlaintext` 這一道「回填前是 NULL 就拋例外」的檢查——理由見檔頭。**仍然保留獨立
 * 型別與這支映射函式，不直接讓 repository 回傳 `EmployeeProfileInput`**：它的回傳型別在語意上
 * 仍然是「稽核用途專用」，與端點回應型別（一律 `xxxMasked`）刻意分開，維持這個邊界能讓日後若
 * 又需要一支「不遮罩」的用途時，呼叫者清單一樣清楚可查。
 */
export const toPlaintextProfile = (row: EmployeeProfileRow): EmployeeProfileInput => ({
  employeeCode: row.employeeCode,
  name: row.name,
  gender: row.gender,
  identityNumber: requirePlaintext(row.identityNumber, 'identityNumber', row.id),
  birthday: requirePlaintext(row.birthday, 'birthday', row.id),
  phone: requirePlaintext(row.phone, 'phone', row.id),
  email: row.email,
  address: requirePlaintext(row.address, 'address', row.id),
})
