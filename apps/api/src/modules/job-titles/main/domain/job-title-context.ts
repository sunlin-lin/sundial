/**
 * service 的執行相依（純型別，零執行期程式碼）。放在 `domain/` 的理由與 `departments/main/domain/
 * department-context.ts` 相同（§0 的檔名白名單沒有「模組共用型別」的位置）。
 *
 * **沒有 `cipher`**：職稱不含個資欄位。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type JobTitlesMainContext = {
  /** 資料庫連線。交易邊界屬於 service（§4.4）。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。 */
  readonly clock: Clock
  /** 公司範圍。**只能來自已驗證的 token**（§4.2）。 */
  readonly companyId: string
}
