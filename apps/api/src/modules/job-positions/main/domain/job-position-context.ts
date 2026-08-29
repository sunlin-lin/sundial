/**
 * service 的執行相依（純型別，零執行期程式碼）。形狀與 `job-titles/main/domain/job-title-context.ts`
 * 完全同構。
 */
import type { Database } from '../../../../db/client.ts'
import type { Clock } from '../../../../shared/clock.ts'

export type JobPositionsMainContext = {
  readonly db: Database
  readonly clock: Clock
  readonly companyId: string
}
