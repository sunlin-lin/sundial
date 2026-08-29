/** service 的執行相依（純型別，零執行期程式碼）。理由與 `job-title-histories/domain/job-title-history-context.ts` 同構。 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type JobPositionHistoriesContext = {
  readonly db: Database
  readonly clock: Clock
  readonly companyId: string
  readonly operatorCompanyUserId: string
}
