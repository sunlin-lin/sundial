/**
 * service 的執行相依（純型別，零執行期程式碼）。放在 `domain/` 的理由與
 * `departments/main/domain/department-context.ts`、`employees/main/domain/employee-context.ts`
 * 相同（§0 的檔名白名單沒有「模組共用型別」的位置，見該兩檔檔頭）。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type EmploymentsMainContext = {
  /** 資料庫連線。**交易邊界屬於本檔的入口 service**（§4.4），理由見 `impl/*.service.ts` 各檔檔頭。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。 */
  readonly clock: Clock
  /** 公司範圍。**只能來自已驗證的 token**（§4.2）。 */
  readonly companyId: string
  /** 執行本次操作的人（稽核用，稽核計畫 §5）。**只能來自已驗證的 token**。 */
  readonly operatorCompanyUserId: string
}
