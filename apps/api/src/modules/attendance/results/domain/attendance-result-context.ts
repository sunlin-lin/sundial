/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀比照 `attendance/records/domain/
 * attendance-record-context.ts`。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type AttendanceResultsContext = {
  /** 資料庫連線。交易邊界屬於 service（§4.4）；批次重算不需要交易（見該 service 檔頭）。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`。 */
  readonly clock: Clock
  /** 公司範圍。只能來自已驗證的 token（§4.2）。批次重算依此範圍掃描，不跨公司。 */
  readonly companyId: string
  /** 操作者的 company_user id。`list-own`（Stage 7）用它由 `company_user → employee_id` 解出
   * 呼叫者本人，比照 `attendance/records` 的既有先例。批次重算不需要它。 */
  readonly operatorCompanyUserId: string
}
