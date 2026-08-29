/**
 * zh-TW 的完整訊息目錄：把各大目錄的語系檔組裝成一棵樹。
 *
 * **本檔不放任何字**，只做組裝——新增一個大目錄＝多一個檔案 ＋ 下面多一列，
 * 而「多的那一列忘了加」的症狀是那個模組的錯誤碼在 `satisfies Record<string, ErrorCode>`
 * 那一行當場編譯不過（見 `../../messages.ts`），不是執行期查不到訊息。
 *
 * 頂層的每一個 key 就是訊息 key 的第一段，而它**必須等於 `modules/` 底下的目錄名**
 * ——這是「key 由路徑機械推導」這條規則唯一需要人維護的接點，其餘三段都在各語系檔裡跟著目錄長。
 */
import { COMPANY_USERS } from './company-users.ts'
import { DEPARTMENTS } from './departments.ts'
import { EMPLOYEES } from './employees.ts'
import { EMPLOYMENTS } from './employments.ts'
import { PERMISSIONS } from './permissions.ts'
import { PLATFORM } from './platform.ts'
import { REGULATORY } from './regulatory.ts'
import { ROLES } from './roles.ts'
import { SESSIONS } from './sessions.ts'
import { SHIFTS } from './shifts.ts'
import { WITHHOLDING } from './withholding.ts'

/**
 * 業務錯誤碼的訊息樹（§1.3）。**這棵樹的 key 攤平之後就是 `ErrorCode` 聯集**（見 `../../messages.ts`）。
 *
 * 平台訊息刻意不在這裡：它們不是業務錯誤碼，混進來會讓 `ErrorCode` 裝得下
 * 「系統發生錯誤」這種不屬於任何 service 的東西，而各模組的 `satisfies Record<string, ErrorCode>`
 * 就再也擋不住有人拿它當業務碼用。
 */
export const ZH_TW_ERRORS = {
  sessions: SESSIONS,
  roles: ROLES,
  permissions: PERMISSIONS,
  employees: EMPLOYEES,
  'company-users': COMPANY_USERS,
  regulatory: REGULATORY,
  shifts: SHIFTS,
  departments: DEPARTMENTS,
  employments: EMPLOYMENTS,
  withholding: WITHHOLDING,
} as const

/** 平台層訊息樹（envelope 頂層 `msg` 在非 `300` 路徑上用的那幾句）。理由見 `platform.ts` 檔頭。 */
export const ZH_TW_PLATFORM = {
  platform: PLATFORM,
} as const

/** zh-TW 的完整目錄。預設語系，因此**依定義是完整的**：訊息 key 這份清單本來就由它算出來。 */
export const ZH_TW = {
  ...ZH_TW_ERRORS,
  ...ZH_TW_PLATFORM,
} as const
