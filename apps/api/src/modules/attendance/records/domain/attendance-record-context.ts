/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀比照 `attendance/settings/domain/
 * attendance-settings-context.ts`。
 *
 * **沒有 `cipher`**：座標與地址是明文欄位（計畫 §4.2），不需要欄位加解密器。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type AttendanceRecordsContext = {
  /** 資料庫連線。交易邊界屬於 service（§4.4），因此 context 拿到的是連線本身而不是交易物件。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`。 */
  readonly clock: Clock
  /** 公司範圍。只能來自已驗證的 token（§4.2）。 */
  readonly companyId: string
  /** 操作者的 company_user id。供 `revoke-other` 寫稽核時標記 `actor`，及供本人動作推導身分。 */
  readonly operatorCompanyUserId: string
}
