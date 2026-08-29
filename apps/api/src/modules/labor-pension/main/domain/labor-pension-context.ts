/** service 的執行相依（純型別，零執行期程式碼）。形狀與 `withholding/main/domain/withholding-context.ts` 同構。 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type LaborPensionMainContext = {
  readonly db: Database
  readonly clock: Clock
  readonly companyId: string
  readonly operatorCompanyUserId: string
}
