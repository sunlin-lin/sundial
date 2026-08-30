/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀比照 `attendance/records/domain/
 * attendance-record-context.ts`。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type AttendanceCorrectionRequestsContext = {
  /** 資料庫連線。本次目錄的三個動作都不需要多語句交易（見各 `impl/*.service.ts` 檔頭），
   * 因此 context 拿到的一律是連線本身。 */
  readonly db: Database
  /** 可注入的「現在」（§6.2）。業務程式碼禁止直接 `new Date()`。 */
  readonly clock: Clock
  /** 公司範圍。只能來自已驗證的 token（§4.2）。 */
  readonly companyId: string
  /** 操作者的 company_user id。補打卡申請本輪只有本人動作（提交／查詢／撤回），這裡用來推導
   * 「操作者是哪個員工」，不供代人操作使用。 */
  readonly operatorCompanyUserId: string
}
