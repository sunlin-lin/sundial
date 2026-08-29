/**
 * 性別代碼在畫面上的文字（§1.3 的第 (2) 類，共用版）。
 *
 * ## 為什麼在 `shared/`
 *
 * §1.5：兩個以上頁面實際共用時才移入共用區。這一份原本只有 `employees/main`（員工清單）在用；
 * `employees/onboarding`（新增員工）的性別欄位也要顯示同一組文字，於是有了第二個使用者
 * （理由與 `shared/regulatory/sync-status.ts` 的檔頭同構，不重述）。
 *
 * ## 為什麼放在 `shared/employees/` 而不是 `shared/format/`
 *
 * `shared/format/` 是「值 → 字串」的通用格式化（金額、日期），這裡是「代碼 → 固定的一組呈現決策」
 * ——與 `shared/regulatory/sync-status.ts` 是同一類判斷，理由同構，因此比照它另立一個以業務領域
 * 命名的子目錄，不是塞進既有四個目錄裡讓其中一個定義變模糊。
 */
import type { EmployeesMainListData } from '../../api/generated/api-client.ts'
import type { MessageKey } from '../i18n/messages.ts'

/** 性別代碼。由產生型別推導，不在前端另列一份（§3.2）。 */
export type GenderValue = EmployeesMainListData['data'][number]['gender']

const GENDER_LABEL_KEY = {
  MALE: 'employees.gender.male',
  FEMALE: 'employees.gender.female',
} as const satisfies Record<GenderValue, MessageKey>

export const genderLabel = (gender: GenderValue, translate: (key: MessageKey) => string): string =>
  translate(GENDER_LABEL_KEY[gender])
