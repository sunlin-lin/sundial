/**
 * service 的執行相依（純型別，零執行期程式碼）。放在 `domain/` 的理由與 `employees/main/domain/
 * employee-context.ts` 相同（§0 的檔名白名單沒有「模組共用型別」的位置）。
 *
 * 形狀與 `EmployeesMainContext` 逐字相同——onboarding 這一次交易要用到的相依集合，
 * 剛好就是四個被編排模組（`employees`／`employments`／`withholding`／`company-users`）
 * 各自 context 的聯集（它們的欄位彼此相同，只有 `cipher` 是 `employees` 專屬）。
 */
import type { Database } from '../../../../db/client.ts'
import type { FieldCipher } from '../../../../db/field-encryption.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type OnboardingContext = {
  /** 資料庫連線。**交易邊界屬於本模組的入口 service**（§4.4）：這裡開唯一的那個交易。 */
  readonly db: Database
  /** 欄位加解密器（§5.1），轉交給 `employees/main` 建立人員主檔。 */
  readonly cipher: FieldCipher
  /** 可注入的「現在」（§6.2）。整筆交易內的每一項異動與稽核都共用同一個時間戳。 */
  readonly clock: Clock
  /** 公司範圍。**只能來自已驗證的 token**（§4.2）。 */
  readonly companyId: string
  /** 執行本次操作的人（稽核用）。**只能來自已驗證的 token**。 */
  readonly operatorCompanyUserId: string
}
