/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀與 `employees/main/domain/employee-context.ts`
 * 同構。**不再需要 `cipher`**：眷屬的身分證字號與員工一樣，敏感欄位已改回明文儲存
 * （改由資料庫端靜態加密負責，見 `db/schema/employee-dependents.ts` 檔頭），
 * service／repository 不再需要欄位加解密器。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type DependentsMainContext = {
  readonly db: Database
  readonly clock: Clock
  readonly companyId: string
  readonly operatorCompanyUserId: string
}
